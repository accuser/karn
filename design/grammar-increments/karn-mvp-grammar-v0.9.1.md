# Karn v0.9.1 — Hardening Increment

A consolidation increment, not a feature bump. It addresses three findings from
the first real project built in Karn (the URL-shortener exercise) that block or
undermine the test-driven workflow every subsequent increment depends on:

1. **`karnc test` source-tree rooting** (finding #8) — `test` rejects the layout
   `compile <dir>` accepts, because the two commands root unit-identity
   resolution differently. This blocks running tests at all.
2. **`assert` as an expression** (finding #9) — `assert` is currently a
   statement, so it can't appear as a match-arm body, which is where real tests
   put it constantly. Promoting it to an expression of type `()` fixes this.
3. **TypeScript verification of emitted output** (the standing v0.9 gap) — the
   compiler's emitted TypeScript has never been checked under `tsc --strict`;
   "compiles cleanly" rests on visual review, which hid four bugs in v0.5–v0.7.

Only item 2 is a grammar change. Items 1 and 3 are compiler/tooling fixes.

Read the earlier specs and the URL-shortener findings log for context. The
v0.9.1 compiler accepts every v0–v0.9 program unchanged, and every v0–v0.9 test
fixture must continue to pass.

---

## 1. Scope

### In scope

- Unify source-tree rooting between `karnc test` and `karnc compile <dir>` so
  both strip the configured `[paths]` roots before matching qualified names.
- Promote `assert` from a statement to an expression of type `()`, valid in any
  expression position within a test body (including match-arm bodies).
- Add a `tsc --strict` verification stage to the compiler's test harness that
  compiles emission fixtures and fails on any TypeScript error.
- A small diagnostic fix to the project-mode error from finding #4 (it names an
  internal symbol, `compile_project`, rather than a user-facing command).

> **Lexical note (documentation, not a change):** compound refinement predicates
> conjoin with the keyword `and`, not `&&` — e.g. `Int where NonNegative and
> LessThan(100)`. This is existing behaviour; it's recorded here because it
> wasn't obvious from the examples and surfaced during the URL-shortener work.
> No grammar change; the documentation and examples should use `and`.

### Out of scope (deferred to their own increments)

- **Refined-type construction ergonomics** (finding #7) — compile-time literal
  refinement checking and `Mock[T]`. Its own increment, next.
- **Nested constructor patterns** (the v0.6 spec/impl divergence) — its own
  increment.
- **`on queue` / `on cron`** (v0.10).
- **`assert` failure messages** — `assert cond, "message"`. A nicety, not needed
  here; `assert` stays single-argument.
- **Broader build/CLI diagnostics polish** (findings #5, #6) — worthwhile but
  not blocking; can follow.

---

## 2. Item 1 — Unified source-tree rooting

### 2.1 The problem

`karnc compile --target bundle --output out src` succeeds: passing `src` as the
input roots unit-identity resolution at `src/`, so `src/shortener/analytics.karn`
maps to the qualified name `shortener.analytics` (strip the `src/` root, the
remainder `shortener/analytics.karn` matches the declared name).

`karnc test` fails on the same tree: it roots at the project directory and does
**not** strip the configured `src` path, so it sees `src/shortener/analytics.karn`
and reports it doesn't match `shortener.analytics` (it expected
`shortener/analytics.karn`). The two commands use different rooting logic.

### 2.2 The fix

Both commands must resolve unit identity through one shared function. The rule:

- A **source unit** (commons or context) has its identity computed by stripping
  the configured **`[paths] src`** prefix from its path, then matching the
  remainder against the declared qualified name. `src/shortener/analytics.karn`
  with `src = "src"` → remainder `shortener/analytics.karn` → must equal the path
  form of `shortener.analytics`. ✓
- A **test unit** (a `test` declaration) has its identity computed by stripping
  the configured **`[paths] tests`** prefix, then matching the remainder against
  the **target** qualified name the test declares. `tests/shortener/analytics.karn`
  with `tests = "tests"` declaring `test shortener.analytics` → remainder
  `shortener/analytics.karn` → must equal the path form of the target
  `shortener.analytics`. ✓

`karnc test` therefore:
1. Reads `[paths] src` and `[paths] tests` from `karn.toml`.
2. Compiles the source units under `src` (identical to `compile`'s project mode).
3. Loads the test units under `tests`, each rooted by stripping `tests`, each
   targeting a source unit by qualified name.
4. Runs the test cases.

The path-stripping-and-matching logic is **one function** used by both `compile`
project mode and `test`. The bug is that they diverged; the fix is that they
must not.

### 2.3 Test-unit layout convention

A test targeting `shortener.analytics` lives at `tests/shortener/analytics.karn`
(single-file) or `tests/shortener/analytics/*.karn` (multi-file) — mirroring the
source-unit layout rule, but rooted at `tests` instead of `src`. A test file
whose path (after stripping `tests`) doesn't match its declared target is a
`karn.project.inconsistent_test_path` error, with the same helpful "expected
path" note the source-unit error already gives.

**Extension convention (settled).** Under split-mode (`tests` root), test files
use the plain `.karn` extension, not `.test.karn`. The path-must-match-target
rule requires it: a `.test.karn` infix would make the stripped path
`shortener/analytics.test.karn`, which can't match the target name
`shortener.analytics`. Disambiguation between a source unit and its test comes
from the **root** (`src` vs `tests`), not from the filename — and the matching
relative path under each root makes the test-to-target correspondence obvious.
The `.test.karn` naming used by the compiler's own legacy single-tree fixtures
is an internal convention only; it does not apply to split-mode projects, and
the two should not be conflated.

### 2.4 Validation

- `karnc test` on the URL-shortener layout (`src/shortener/*.karn`,
  `tests/shortener/*.karn`) resolves cleanly — no `inconsistent_commons_name`
  errors.
- `karnc compile <dir>` behaviour is unchanged.
- A deliberately mismatched test path (e.g. `tests/wrong/analytics.karn`
  declaring `test shortener.analytics`) still errors, via the new
  `inconsistent_test_path` diagnostic.

---

## 3. Item 2 — `assert` as an expression

### 3.1 The problem

`assert` is a statement. A match-arm body is an expression position. So the
single most common test shape — destructure an outcome, assert on what's inside —
fails to parse:

```karn
match result {
  Ok(total) => assert total == 1   -- ERROR: expected an expression, found `assert`
  Err(_)    => assert false
}
```

The current workaround is to wrap every arm in a block (`=> { assert ... }`),
which is noise. Refined-construction (finding #7) compounds this: obtaining a
value already forces a match, so asserts land in arm position constantly.

### 3.2 The fix

`assert` becomes an **expression** of type `()`.

```
expr ::= ...
       | 'assert' expr            -- NEW: assertion expression, type ()
```

Semantics:
- `assert e` evaluates `e` (which must have type `Bool`).
- If `e` is `true`, the expression yields `()` and evaluation continues.
- If `e` is `false`, the enclosing **test case** fails immediately (evaluation of
  that case aborts). The failure records the source location of the assertion.
- The type of `assert e` is `()` regardless.

### 3.3 Consequences

- **Match-arm bodies:** `Ok(total) => assert total == 1` now type-checks. All
  arms have type `()`, so the match is exhaustive-and-uniform at `()`. The block
  form `=> { assert ... }` still works (a block whose tail expression is the
  assertion, type `()`).
- **Statement position (regression):** `let x <- f()` followed by a line
  `assert x == 1` still works — it's now an expression used in statement
  position (an expression-statement), which is valid. Existing v0.7+ tests that
  used `assert` as a statement are unaffected.
- **Test-privileged:** `assert` remains valid **only inside a test body** (a
  `test` declaration's case blocks). Using `assert` in a context/commons handler
  is a `karn.types.assert_outside_test` error, as before. Promotion to an
  expression doesn't widen where it's allowed — only how it composes.

### 3.4 Interaction with effects and auto-lift

A test case body may be effectful (uses `<-`). `assert e` is pure (it inspects a
`Bool`); it does not itself introduce an effect. Where a test case body's tail is
an `assert` (directly or via a match), the body's value type is `()`; if the
surrounding test-case type is `Effect[()]`, the standard v0.7.1 auto-lift applies
(`()` lifts to `Effect[()]`). No new lifting rule is needed — `assert`'s `()`
result participates in auto-lift like any other value.

---

## 4. Item 3 — TypeScript verification of emitted output

### 4.1 The problem

The compiler emits TypeScript (bundle and workers targets, plus `runtime.ts`).
Whether that output actually compiles under `tsc --strict` has only ever been
checked by eye. Visual review is unreliable: it passed for the four emitter bugs
that the v0.7 runtime-emission task uncovered only by executing the output. Every
increment since v0.9 has added emission surface (the HTTP router, path-param
extraction, HttpResult serialisation) that has never been type-checked.

### 4.2 The fix

Add a verification stage to the compiler's test harness:

- For each **emission fixture** (a Karn program that compiles to TypeScript), the
  harness compiles it, writes the output to a temp dir, and runs
  `tsc --strict --noEmit` over the emitted files plus `runtime.ts`.
- Any TypeScript error fails the fixture.
- The stage covers both `--target=bundle` and `--target=workers` output.
- The URL-shortener project is added as a fixture and must pass `tsc --strict`.

### 4.3 Environment requirement

The stage needs TypeScript available. The build/CI environment must provide
`tsc` (e.g. a pinned `typescript` dev-dependency invoked via `npx tsc`, or a
vendored compiler). If `tsc` is genuinely unavailable in an environment, the
stage must **skip loudly** — emit a clear warning that TypeScript verification
was skipped — never silently pass. A skipped verification must be visible in the
test output so it's never mistaken for a green check.

In CI, `tsc` availability is mandatory and a skip is a failure. Locally, a skip
is permitted with the warning.

### 4.4 What this catches

This is the stage that would have caught the v0.5–v0.7 emitter bugs without
needing hand-written execution harnesses. Going forward it's the backstop for
every emission change: if the generated TypeScript doesn't type-check, the
fixture is red, full stop.

---

## 5. Item 4 — Project-mode diagnostic fix (small)

The finding #4 error currently reads (paraphrased) "single-file compilation does
not support contexts; use `compile_project` instead." `compile_project` is an
internal symbol, not a command a user types. Replace the note with the
user-facing instruction: compile the whole project by passing the source
directory, e.g. `karnc compile --target bundle --output out src` — naming the
actual invocation. This brings the one sub-par diagnostic up to the standard the
parser and checker already set.

(The broader build/CLI discoverability work from findings #5 and #6 is not in
scope; this is just the one-line message fix directly adjacent to the item-1
work.)

---

## 6. Test corpus

### Positive fixtures (new for v0.9.1)

```
tests/positive/
├── 130_assert_in_match_arm/          -- assert as a match-arm body, type ()
├── 131_assert_nested_match/          -- assert in arms of a nested match
├── 132_assert_statement_regression/  -- assert as a top-level statement (still works)
├── 133_assert_block_body/            -- assert as the tail of a block arm (still works)
```

### Negative fixtures (new for v0.9.1)

```
tests/negative/
├── 101_assert_outside_test/          -- assert in a context handler -> assert_outside_test
├── 102_assert_non_bool/              -- assert on a non-Bool expression -> type error
├── 103_inconsistent_test_path/       -- test path doesn't match its target qualified name
```

### Integration fixtures

```
tests/projects/
├── url_shortener/                    -- the full exercise project; must:
│                                        (a) compile under both targets,
│                                        (b) pass `karnc test` (rooting fix),
│                                        (c) pass `tsc --strict` on emitted output
```

The URL-shortener project becomes a permanent integration fixture. Its presence
is the regression guard for all three items at once: rooting (it has the
`src/`–`tests/` split), `assert` (its tests assert in match arms), and tsc
verification (its emission is checked).

Note: the URL-shortener tests as written still construct refined values via
`.of(...)` with match-unwrapping (finding #7 is not yet addressed). That's fine —
the fixture exercises v0.9.1's three items and will be simplified when the
refined-construction increment lands.

---

## 7. Implementation notes

### 7.1 Where the code goes

- **Item 1 (rooting):** the project loader / unit-identity resolver. Extract the
  path-strip-and-match logic into one function; call it from both `compile`
  project mode and `test`. `test` reads `[paths] src` and `[paths] tests`.
- **Item 2 (`assert`):** `lexer.rs` already has `assert`; `parser.rs` moves it
  from statement to expression production; `ast.rs` gains an `Expr::Assert`;
  `checker.rs` types it as `()`, requires `Bool` operand, retains the
  test-privilege check; `emitter.rs` emits the assertion as a `()`-valued
  expression (e.g. an IIFE or a runtime `assert_(cond, loc)` helper returning
  `undefined`).
- **Item 3 (tsc):** the test harness (likely `tests/harness.rs` or the
  integration-test runner). Add the emit-then-`tsc --strict --noEmit` stage.
- **Item 4 (diagnostic):** the single error-message string in the project loader.

### 7.2 `assert` emission

As an expression of type `()`, `assert e` should emit to something that evaluates
`e`, throws/records a failure on `false`, and is `()`-valued. A runtime helper is
cleanest:

```typescript
function assert_(cond: boolean, loc: string): void {
  if (!cond) throw new AssertionFailure(loc);
}
```

In expression position (a match arm), emit `assert_(<cond>, "<loc>")` — a
`void`-returning call, which is `()` in Karn terms. The test runner catches
`AssertionFailure` to mark the case failed with the location. This reuses the
v0.7 test machinery; the only change is that `assert` can now appear in
expression position, so the emitter must handle it as an expression, not only as
a statement.

### 7.3 Risk areas

- **Rooting unification (item 1)** must not change `compile`'s behaviour. The
  safest implementation extracts `compile`'s existing (correct) logic into the
  shared function and points `test` at it — rather than writing new logic. Run
  the full v0–v0.9 fixture suite to confirm `compile` is untouched.
- **`assert` as a statement (regression)** must keep working. An
  expression-statement form (`assert e` on its own line) is the bridge: the
  parser should accept an expression in statement position, of which `assert e`
  is now one case. Verify every v0.7+ test fixture still parses.
- **tsc skip must be loud.** The single worst outcome is a silently-skipped tsc
  stage that lets emission bugs through under a green suite. Make the skip a
  visible warning, and a hard failure in CI.

### 7.4 What "done" looks like

1. All v0–v0.9 fixtures pass (regression).
2. All v0.9.1 fixtures pass (4 positive, 3 negative, 1 integration project).
3. `karnc test` runs the URL-shortener tests cleanly (rooting fixed).
4. `assert` works in match-arm position; statement-position `assert` still works.
5. `assert` outside a test is still rejected.
6. The `tsc --strict --noEmit` stage runs over emission fixtures and the
   URL-shortener output, and passes — or skips with a loud, visible warning if
   TypeScript is unavailable (CI: hard requirement, no skip).
7. The finding-#4 diagnostic names the real command.
8. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean.

---

## 8. After v0.9.1

The workflow is unblocked and verified: tests run, `assert` composes naturally,
emitted TypeScript is type-checked. The roadmap resumes:

- **Refined construction** (finding #7) — compile-time literal refinement
  checking; `Mock[T]`. The most significant language finding; its own increment.
- **Nested constructor patterns** — close the v0.6 spec/impl divergence.
- **v0.10** — `on queue` and `on cron` (background processing).
- **v0.11+** — state machines, provider composition, refinement narrowing,
  sagas, cross-context capability resolution, multi-Worker integration testing.

The first time `karnc test` runs the URL-shortener tests is also the first time
any Karn code executes end to end — which is where **agent state initialisation**
(does a fresh agent key's state read as zeroed, undefined, or require an
initialiser?) finally gets answered. Watch the first test run for it; it's the
one runtime question no amount of compilation has been able to reach.
