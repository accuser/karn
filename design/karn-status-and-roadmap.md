# Karn — Status & Gap Audit

_Prepared 5 June 2026. Scope: the whole `Karn/` repo — compiler (`karnc`), formatter (`karn-fmt`), language server (`karn-lsp`), tree-sitter grammar, and VS Code extension — assessed against the language's own specs._

> **Updated 5 June 2026 for v0.9.2 (Agent-Emission Repair).** The agent-emission increment that was in flight at the first audit has landed and is **committed** (head `fe22dc6 Karn grammar v0.9.2`): agents now emit valid TypeScript in both targets, and agent-state initialisation (finding #10) is answered by demonstration — fresh state zero-initialises. One correction to the original audit's P0 is folded in below: the placeholder v0.9.2 removed is a *different* one from the bug this audit flagged — see §4.

## How to read this audit

Karn is described by three tiers of documents, and conflating them produces a misleading "incomplete" verdict, so this audit keeps them separate:

1. **The grammar increments** (`karn-mvp-grammar-v0.1.md` … `v0.9.1.md`) are the authoritative "what should exist now". They are delivered one increment at a time; **v0.9.1 is the current frontier**.
2. **The type-system spec** (`karn-type-system.md`) and **design notes** (`karn-design-notes.md`) describe an aspirational **v1** language — events, sagas, a query algebra, the full storage-kind catalogue, `actor` contracts, invariants. Most of this is explicitly deferred and must **not** be scored as "missing".
3. **The runtime and tooling specs** (`karn-runtime-spec.md`, `karn-lsp-spec.md`, `karn-tree-sitter-spec.md`) sit alongside, and — importantly — the two tooling specs were written for the **v0.5** language and have not been refreshed.

The headline: the compiler is **near feature-complete for the cumulative v0 → v0.9.1 MVP**, with the language surface overwhelmingly wired end-to-end (parse → check → emit). What remains genuinely "incomplete" falls into four buckets — one latent correctness bug, one increment in flight, a tooling layer that has fallen four versions behind the language, and the large v1 surface that was always roadmap. Each is detailed below.

> Note on verification: this sandbox has no Rust toolchain and the committed `target/` binaries are macOS builds, so the compiler could not be built or its test suite run here. Findings are from source reading and `git` inspection, with key claims spot-checked against the code (citations are `file:line`). "Does it actually pass `cargo test`?" remains unconfirmed and is the first thing to check on a Mac.

---

## 1. Executive summary

| Area | State | One-line verdict |
|---|---|---|
| **Compiler `karnc`** (~22.1k LOC) | Near-complete | Whole v0–v0.9.2 grammar is wired end-to-end; 139 positive / 102 negative fixtures; `tsc --strict` verification of emitted output is in place. |
| **Agent emission (v0.9.2)** | ✅ Landed (committed `fe22dc6`) | Stateful-agent instantiation/dispatch now valid in both targets; fresh state zero-initialises (finding #10 answered). New rule: state fields must be *zeroable* (`karn.agents.non_zeroable_state_field`). |
| **Known latent bug** | 🔧 Fix staged, pending test | Complex `is`-receiver previously emitted `(/* TODO: complex is-receiver */ )` → invalid TS. Now lifted to a shared temp in the emitter; the placeholder guard is broadened to catch the marker; fixture `142_is_complex_receiver` exercises both binding paths. Uncommitted in the working tree — awaiting `cargo test` / bless on a Mac. |
| **`karn-fmt`** | ~92% | Strongest component; already ahead of its spec. Only gap: comments buried inside expressions. |
| **`tree-sitter-karn`** | ~85% of its v0.5 spec / ~55% of current language | Frozen at v0.5; no `on http`, `assert`-expr, `test`/`mocks`, or `HttpResult`. |
| **`vscode-karn`** | ~75% | LSP client + status bar solid; tree-sitter grammar is never actually registered (uses a TextMate grammar instead). |
| **`karn-lsp`** | ~70% | Every in-scope capability present and happy paths work; uses single-file diagnostics + per-request file rescans instead of the spec's project model. |
| **v1 surface** (events, sagas, storage kinds, query algebra) | Deferred by design | Roadmap, not gap. |

---

## 2. What is done — the implemented language

The compiler runs a textbook pipeline — **lex → parse → resolve → check → emit** (`karnc/src/lib.rs:5`) — plus a two-pass multi-file project driver (`karnc/src/project.rs:191`), two build targets (`bundle`, `workers`), a test runner, and a formatter. The following are **fully wired end-to-end** and exercised by fixtures:

- **Types**: refined types over `Int`/`String`/`Bool` with the predicate vocabulary (`Matches`, `InRange`, `MinLength`/`MaxLength`/`Length`, `NonNegative`, `Positive`, `NonEmpty`), records, sum types (pipe and `enum` forms, payloads, qualified/unqualified variants), opaque types (with `.raw`/`.unsafe` access gated to the defining commons), and the built-in generics `Result`, `Option`, `Effect`, `HttpResult`, `ValidationError`, `()`.
- **Expressions / statements**: all operators, `if`/`else` as a value, `match` (exhaustiveness, unreachable/duplicate-arm checks, positional and named bindings), the `is` operator with branch-flow binding, the `?` propagation operator (including inside `Effect[Result]`), `let` / `let <-`, `commit`, and `assert` (now an expression of type `()` as of v0.9.1).
- **Methods**: instance and static methods, lowered to UFCS (`Type.method(receiver, …)`).
- **Effects**: the `Effect[T]` type, `<-` await, `given`-clause capability injection, providers, `Effect.pure`, and tail-position auto-lift (`T` → `Effect[T]`) with `async`/`await` emission.
- **Architecture**: `commons`, `context` (with `exports opaque`/`transparent`), `uses` mixins, `consumes` dependency edges, capabilities, providers, services, and agents (→ Durable-Object-style classes with `state`/`commit`).
- **Cross-context calls** with structural compatibility checking and return-type rebranding across namespace boundaries (`karnc/src/checker.rs:3205`, `:3244`).
- **HTTP** (v0.9): `on http METHOD "/path/:id"` handlers, method routing, path-param binding, typed body deserialisation, and the `HttpResult[T]` status vocabulary (200/201/204/400/401/403/404/409/422/500).
- **Tests** (v0.7): `test` units targeting commons and contexts, provider/context mocking (`mocks`), assertion machinery, and a readable test runner.
- **Build**: `bundle` (single bundle, with a composition root) and `workers` (per-context Worker bundles with generated `index.ts`, `compose.ts`, and `wrangler.toml`), both shipping a shared `runtime.ts`.
- **Quality gate** (v0.9.1): every project-form fixture's emitted TypeScript is compiled with `tsc --strict --noEmit` in `karnc/tests/tsc_verify.rs`, so emission bugs that previously hid behind eyeballing now fail the suite.

Fixture frontier by area gives a quick read on how far each feature has been pushed: refinements → `10_multiple_refinements`; contexts → `79_full_layered_project`; effects/services → `88_service_with_result_propagation`; agents → `96_full_order_agent`; tests → `110_full_orders_payment_tests`; auto-lift → `116_auto_lift_in_agent`; workers → `121_workers_with_agent`; HTTP → `129_full_orders_http_api`; assert-expression → `133_assert_block_body`; integration → `134_url_shortener`.

All four v0.9.1 "hardening" items are **landed and committed** (verified clean in `git`): unified source-tree rooting, `assert` as an expression, the `tsc` verification stage, and the project-mode diagnostic fix.

---

## 3. v0.9.2 — Agent-Emission Repair (landed, committed `fe22dc6`)

The increment that was in flight at the first audit is now committed, verified at the source level (build/`cargo test` not re-run here — see the verification note). It replaces the broken agent emission with a real instantiation/dispatch model and answers the open state-initialisation question.

**The four bugs, resolved (verified in source):**

1. **Instantiation** — `AgentName(key)` now lowers to a generated `__makeAgentName(key)` factory backed by `makeAgent(registry, binding, key, ctor)` (`emitter.rs:391`). Bundle mode looks up/creates state in a per-agent `StateRegistry` (`emitter.rs:330`), so the same key reuses the same state within a session; workers mode returns a typed Durable-Object proxy. The old `new Agent(makeTestState(String(key)))` — fresh state every call, so state never accumulated — is gone from the live path.
2. **Method calls** — direct `await hits.increment(deps)` in both targets; workers routes through a `Proxy` → `callDurableObjectMethod` over `/_karn/agent/<method>` (`emitter.rs:350`), with a generated fetch dispatcher on each DO class. Call sites are byte-identical across targets.
3. **`makeSurface` deps type** — emits an explicit `<Ctx>Deps` interface (providers + consumed-context surfaces); the `Parameters<>[1]` multi-arg mistyping is gone. Covered by `141_makesurface_multi_arg`.
4. **State init** — `loadState` is now `const stored = …; return stored ?? __zeroOf<Name>State();` (`emitter.rs:2327`). Zeroability is checked in the checker (`checker.rs:3506`+); non-zeroable fields raise `karn.agents.non_zeroable_state_field` (`project.rs:2920`), with the note suggesting the `Option` workaround.

**Finding #10 answered by demonstration.** Both state-init probes in `135_url_shortener_stateful` now go green: a fresh `Hits` key reads `count` as `0` (`Int → 0`) and a fresh `Link` key resolves to `NotFound` (`Option → None`). The conclusion: **fresh agent state zero-initialises.** The fixture's `out/`/`out-js/` draft dirs (which held the old broken emission) were removed; `expected/` is now authoritative.

**New language rule with an honest consequence.** Every agent `state` field must be *zeroable*. This deliberately outlaws sum-typed state — which is exactly negative fixture `104_state_sum_field`. The one pre-existing program it broke, `96_full_order_agent` (`status: OrderStatus`), was migrated to the documented escape hatch `Option[OrderStatus]` (verified: `96_full_order_agent/src/commerce/orders.karn:36`).

**Also fixed en route** (latent, fixture-blocking, outside the four-item list): re-exported refined/opaque commons constructors with a brand-preserving cast (so `CommonsType.of(...)` works in a re-branding context); a statement-position `match` on a call discriminant now binds the discriminant to a temp instead of re-evaluating per arm (and the test-body match-as-IIFE goes `async` when its arms `await`); and a pre-existing non-determinism (HashMap iteration of mocks/capabilities in test emission) is now sorted.

**New test surface:** positive fixtures `136`–`141` (incl. `137` workers), negatives `104`–`106`, a `KARN_BLESS=1` snapshot regenerator (`e2e.rs`), and `runtime_helpers.rs` unit-testing the helpers against a fake DO stub. The new `no_unknown_placeholder_in_emitted_output` guard (`e2e.rs:268`) compiles every fixture and fails on the `/* unknown */` marker — the regression backstop the v0.7 fix lacked. (Caveat: that guard is scoped to one marker string — see §4.)

---

## 4. Real gaps in the compiler (against current scope)

These are genuine shortfalls within the language as already specified — not future increments.

**P0 — `is`-receiver emitter stub (latent invalid-TS bug — STILL LIVE after v0.9.2).** This is a *different* placeholder from the one v0.9.2 removed, and the nuance matters. v0.9.2 fixed `lower_expr`'s instance-method-call arm, whose unresolved-receiver fallback emitted `/* unknown */` (`emitter.rs:3155`), and added a harness guard (`no_unknown_placeholder_in_emitted_output`, `e2e.rs:268`) — **but that guard greps for exactly one string, `"/* unknown */"`**. The bug this audit flagged lives in a separate function, `value_text_for_is` (`emitter.rs:3290`), which only handles `Ident`, `FieldAccess`, and `Paren` receivers; anything else (e.g. a binding-producing `is` on a call, `f(x) is Ok(n) && …`) still emits `"(/* TODO: complex is-receiver */ )"` (`emitter.rs:3297`) — broken TypeScript. Because the marker text differs, **the new guard does not catch it**, and no current fixture exercises a complex `is`-receiver, so `tsc --strict` doesn't catch it either. The code comment still assumes "the checker should reject anything that makes this dangerous", but `check_is` imposes no such restriction. **Fix (cheap + correct)**: (a) immediately, broaden the guard's marker set to also fail on `/* TODO` / `complex is-receiver`; (b) properly, lift a complex `is`-receiver to a temporary in the emitter (as v0.9.2 already did for the statement-position `match`-on-call-discriminant case) or restrict it in the checker, with a fixture to lock it in.

> Note on the `/* unknown */` literal: it remains in source at `emitter.rs:3155` as a *defensive* fallback below the new agent-receiver arms — it is no longer reachable by any fixture, and the guard enforces that. That is consistent with v0.9.2's "confirmed absent from emitted output"; the string in source is a backstop, not a live path.

**Reserved-but-dead keywords.** `record` and `expect` are reserved by the lexer (so they can't be identifiers) but have **zero references anywhere else** in the source (verified). `record` is dead because record types use `type X = { … }`; `expect` strongly implies an intended test-matcher DSL that was never built. Decide: implement, or release the keywords.

**Brittle cross-context structural matching.** Structural compatibility across boundaries compares refinement predicates **positionally** — "predicate order matters here" (`checker.rs:3398`). Two structurally identical types whose predicates are written in a different order will spuriously fail to match. Documented as conservative, but a foot-gun.

**`Int` precision mismatch.** `Int` literals are validated as `i64` at lex time (`lexer.rs:404`) but emit to a JS `number` (`emitter.rs:3383`), so values beyond 2^53 silently lose precision at runtime. Either narrow `Int` to safe-integer range at the type level or emit `bigint`.

**Workers-edge type safety.** The `bundle` path is fully typed, but `workers`-mode emission leans on `any` at the boundary (`emitter/workers.rs:106`) plus runtime serialisation helpers, so static guarantees degrade exactly where they matter most.

**Diagnostics plumbing smells.** The CLI parser bails on the first error (`parser.rs:190`); only the LSP path recovers. Header doc-block *warnings* are smuggled through the *error* channel and re-classified by string prefix in `lib.rs:52` — a fragile coupling worth a proper warning channel.

**Open spec questions that block the next increments** (called out in the specs themselves): agent-state initialisation semantics (above); refined-type **construction ergonomics** — still `.of(...)`-with-match-unwrap, plus the missing `Mock[T]` (the spec's "most significant language finding", `v0.9.1` §8); and the known **v0.6 nested-constructor-pattern** spec/impl divergence.

---

## 5. Tooling gaps

The compiler has outrun its editor tooling. The tree-sitter grammar and both editor-facing components are pinned at **v0.5** while the language reached v0.9.1.

**`karn-fmt` (~92%, strongest).** Delivers the full formatter contract including the hard comment-preservation requirement, is idempotent and round-trip-tested over the whole fixture corpus, and is already *ahead* of its spec (formats `assert`, `HttpResult`, `test`/`mocks`). Only real gap: comments buried inside expression sub-trees are folded into the enclosing statement's trivia or dropped (`karnc/src/fmt.rs:17`).

**`tree-sitter-karn` (~85% of v0.5 spec; ~55% of current language).** A well-built grammar with near-complete v0–v0.5 coverage and a full highlights query, but frozen: a `grep` for `http|assert|test|HttpResult|mocks` in `grammar.js` returns nothing. So a modern Karn file with an `on http` route, an `assert` expression, a `HttpResult[T]`, or a `test`/`mocks` unit produces ERROR nodes and broken highlighting. Also missing within its own spec: the `consumes … as <alias>` form, and the spec-required `doc-blocks.txt` / `errors.txt` corpus files.

**`vscode-karn` (~75%).** LSP-client wiring and the status bar fully satisfy the spec, but the headline gap is that the spec's **tree-sitter-based highlighting is never actually registered** — the extension ships and uses a hand-written TextMate grammar instead, so the tree-sitter grammar is effectively unused by the editor. Minor: the "compiler version" status item runs `karnc-lsp --version`, reporting the *server's* version, not the compiler's.

**`karn-lsp` (~70%, last).** Every in-scope LSP capability is present (diagnostics, hover, definition, formatting, document symbols; completion/rename/references/etc. are correctly out of scope) and the happy paths work. But it **skips the spec's project model**: no startup load/resolve/type-check of `src/`; cross-file hover/definition is done by re-reading and re-parsing every `.karn` file on each request (`symbols.rs:211`), and diagnostics are single-file only. Plus a concrete bug — diagnostic secondary spans hardcode `file:///dev/null` (`main.rs:438`) instead of the document URI — and a v0.9 lag (no `HttpResult` in the hover token filter). No handler/diagnostic tests.

---

## 6. Deferred by design (the published roadmap)

These are **not** gaps; the specs schedule them. Captured here so the roadmap in §7 doesn't accidentally re-litigate them.

**Near-term increments** (from `v0.9.1` §8 and the `v0.9` preview): refined-type construction + `Mock[T]` (next); nested constructor patterns; **v0.10** `on queue` / `on cron`; **v0.11** state machines as sums; **v0.12** provider composition; **v0.13** refinement narrowing; **v0.14** sagas / compensation; **v0.15** cross-context capability resolution; **v0.16** multi-Worker integration testing.

**v1 surface** (type-system spec + design notes, deliberately out of MVP): events/subscriptions, the full storage-kind catalogue (`Map`/`Set`/`Log`/`Queue`/`Cache`/`Ref`/`Held`) and query algebra, `actor` boundary contracts, agent invariants, held `Connection`/WebSocket resources, and a `workerd` dev server. The core type theory also deliberately excludes subtyping, higher-rank/higher-kinded polymorphism, row polymorphism, and type classes.

One housekeeping note: the design notes still say the compiler is written in **Go** (`§19`), but it is **Rust**. Treat the Go reference as stale.

---

## 7. Prioritised roadmap

Sequenced by leverage — correctness and "prove it runs" first, then keeping tooling abreast, then the published feature increments.

**Now (close out the current state)**
1. ~~Commit v0.9.2~~ — **done** (`fe22dc6`), gated per the v0.9.2 report (`cargo test` with 62 lib + e2e + runtime-helpers + `tsc --strict` under `KARN_REQUIRE_TSC=1`, `cargo clippy -- -D warnings`, `cargo fmt --check`).
2. ~~Fix the `is`-receiver stub~~ — **fix written, staged in the working tree, pending compile/test.** `value_text_for_is` complex receivers are now evaluated once into a shared temp (`LowerCtx::is_receiver_ref` / `is_receiver_text`, keyed by span); `lower_and_with_is` was reordered to lower before gathering bindings; the `no_unknown_placeholder_in_emitted_output` guard now also fails on `complex is-receiver`; and `142_is_complex_receiver` exercises the `if` and `&&` binding paths. To verify: `KARN_BLESS=1 cargo test bless_positive_fixtures` to generate `142`'s `expected/`, review the diff (expect a `const __rN = classify(n);` shared by the `.tag` check and the `score` binding, no `/* TODO */`), then `KARN_REQUIRE_TSC=1 cargo test` + `cargo clippy -- -D warnings` + `cargo fmt --check`.
3. ~~Land the in-flight agent work~~ — **done in v0.9.2.** Finding #10 is answered (fresh agent state zero-initialises); `135_url_shortener_stateful` now has an authoritative `expected/` and passes all 8 tests under both targets.

**Next (the increment the spec points at)**
4. **Refined-type construction ergonomics + `Mock[T]`** — the spec's most significant open language finding; removes the `.of(...)`-with-match boilerplate that makes real programs awkward.
5. **Resolve the v0.6 nested-constructor-pattern divergence** so spec and implementation agree before more is built on `match`.
6. **Decide `record` / `expect`** — implement the `expect` matcher DSL or free both keywords.

**Keep tooling abreast (parallel track, currently the biggest "incomplete" surface)**
7. **Bring `tree-sitter-karn` to v0.9** — `on http`, `assert` expression, `test`/`mocks` units, `HttpResult`, and `consumes … as`; add the missing `doc-blocks.txt` / `errors.txt` corpus. This is what users *see* first.
8. **Actually register the tree-sitter grammar in `vscode-karn`** (or formally adopt TextMate and update the spec), and fix the version-label bug.
9. **`karn-lsp`**: fix the `file:///dev/null` secondary-span URI; add `HttpResult` to the hover filter; then tackle the project-model architecture (startup resolve/type-check + caching) so cross-file features scale and diagnostics go multi-file.

**Then (published feature increments, in order)**
10. v0.10 `on queue` / `on cron` → v0.11 state machines → v0.12 provider composition → v0.13 refinement narrowing → v0.14 sagas → v0.15 cross-context capability resolution → v0.16 multi-Worker integration testing.

**Lower priority / hygiene**
11. Address the `Int`-precision and workers-edge `any` issues before Karn is used for anything handling large integers or where boundary type-safety is load-bearing.
12. Replace the warning-via-error-channel coupling with a real diagnostic-severity channel.

---

## 8. Bottom line

This is a mature, surprisingly complete compiler — the language is built and verified end-to-end, with a quality gate (`tsc --strict`) guarding emission. As of **v0.9.2**, stateful agents emit valid TypeScript in both targets and Karn has executed for the first time: fresh agent state zero-initialises (finding #10, answered by demonstration), at the cost of a principled new rule that agent state must be zeroable. That removes the "increment mid-landing" from the original audit.

What remains "incomplete" is now down to three honest places: **one latent emitter bug** — the complex `is`-receiver placeholder (`emitter.rs:3297`), which is *not* the one v0.9.2 fixed and *not* covered by its new guard; a **tooling layer four versions behind the language** (tree-sitter/LSP/VS Code still at v0.5); and the **aspirational v1 surface**, which is scheduled, not missing. With v0.9.2 committed (`fe22dc6`), the single highest-value next step is small and concrete: close the `is`-receiver placeholder with a temp-lift and a guard that catches *its* marker too — so the last path that can silently emit invalid TypeScript is gone.
