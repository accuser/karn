# Karn v0.13 Grammar — Refinement Narrowing (`is` on refined types)

A delta specification extending the **`is` operator** to **refined types**:
`value is Quantity` runs the refined type's predicate check at runtime and, in the
positive branch, **narrows** `value` to that refined type. This is the
type-system spec's §2.3.6 "type narrowing" applied to refined types — the
flow-sensitive counterpart to v0.9.4's compile-time literal admission.

Read the earlier specs first — `karn-mvp-grammar.md` through
`karn-mvp-grammar-v0.12.md`, plus `karn-type-system.md` §2.3.6 and §2.5.4. The
v0.13 compiler accepts every v0–v0.12 program unchanged (the addition is
purely additive — a new admissible form of the existing `is` operator).

This is a **design draft for review**. Choices marked **[DECISION]** are the
language-defining calls to settle before implementation. **Please read §1.3 — an
honest assessment of value vs. cost — before approving; v0.13 is a smaller
ergonomic win than prior increments and the scope is worth a deliberate choice.**

---

## 1. Scope

### 1.1 What "refinement narrowing" is (and is not)

The type-system spec separates two things, and only the first is v0.13:

- **§2.3.6 Type narrowing** *(this increment)* — when `e is p` gates subsequent
  evaluation (an `if` body, the right of `&&`), `e`'s type is narrowed and any
  bindings enter scope. Karn already does this for **sum variants** (`r is Ok(n)`
  binds `n`, narrows `r`). v0.13 extends it to **refined types** (`n is Quantity`
  narrows `n` to `Quantity`).
- **§2.5.4 Refinement *propagation* under operations** *(still deferred)* — the
  "largest design question": whether `a + b` of two `NonNegative`s stays
  `NonNegative`. v0.13 does **not** touch this; arithmetic on refined values still
  yields the unrefined base.

### 1.2 The fix

Today, the only way to obtain a refined value from a runtime base value is
`Quantity.of(n)` → `Result[Quantity, ValidationError]`, unwrapped with `match` or
`?`. v0.9.4 added compile-time admission for *literals*. v0.13 adds the
*flow-sensitive* path: check-and-narrow.

```karn
fn reserve(q: Quantity) -> Effect[Result[(), Error]] { … }

-- v0.13: check then use, guard-style
on http POST "/reserve" (body: Req) -> Effect[HttpResult[()]] {
  let n = body.amount            -- n : Int
  if n is Quantity {
    let r <- reserve(n)          -- n : Quantity here — passes directly
    …
  } else {
    BadRequest("quantity out of range")
  }
}
```

`is` also composes in boolean position (`x is Quantity && y is Quantity`) and in
test assertions (`assert n is Quantity`).

### 1.3 Honest assessment — value vs. cost **(read before approving)**

This increment is **narrower and lower-leverage** than v0.10–v0.12, and its
emission is the trickiest yet. Be deliberate:

- **`.of` already exists** and produces a clean branded value via `Ok(q)`. The
  `is` form is *ergonomic sugar* over `match T.of(n) { Ok(n') => …, Err(_) => … }`
  — lighter in `if`/`&&`/`assert`, but not a new capability.
- **Emission is genuinely harder** than prior increments: a TS refined type is a
  *branded* `number`/`string`, so a narrowed variable must be re-bound through a
  cast, and same-name shadowing hits a TDZ — requiring a receiver temp (§5). This
  is the most intricate lowering in the language so far for a modest payoff.
- **The bigger refinement win is propagation (§2.5.4), which stays deferred.**

Three honest options (see [DECISION C]): (a) ship `is`-narrowing as specified;
(b) ship a **leaner** version — `is` on refined types as a *boolean check only*
(usable in conditions and `assert`, **no** variable narrowing), which is far
simpler to emit; (c) **reprioritise** — skip to v0.14 (sagas) and revisit
refinement work as a combined narrowing-plus-propagation increment later. My
recommendation is **(b)** for v0.13 — most of the ergonomic value (guards,
`assert`) at a fraction of the emission cost — with full narrowing folded into the
eventual propagation increment.

### In scope (full form — [DECISION C] option a)

- **`value is RefinedType`** — a runtime refinement check; the operator is `Bool`.
- **Narrowing** of an *ident* value to the refined type in the `if`-body and
  `&&`-right positions (the existing §2.3.6 positions), so it can be used where
  the refined type is expected.
- Reuse of the existing `.of` predicate logic, emitted as a boolean expression.

### Out of scope (deferred)

- **Refinement propagation under operations** (§2.5.4) — unchanged.
- **Inline refinement patterns** `value is _ where InRange(1, 100)` — v0.13 uses
  *named* refined types only; inline predicates are a later add.
- **Else-branch / negative narrowing** — narrowing applies only to positive `is`
  (as today for sums); `!(x is Q)` narrows the else branch, nothing more.
- **Narrowing non-ident values** — `f(x) is Quantity` is a valid boolean check but
  narrows nothing (there is no variable to re-type).
- **`implies`** — not implemented; not added here.

---

## 2. The design at a glance

| | Sum variant `is` (today) | Refined `is` (v0.13) |
|---|---|---|
| `value is P` shape | `r is Ok(n)` / `s is Active` | `n is Quantity` |
| runtime check | `r.tag === "Ok"` | the refinement predicates (`Number.isInteger(n) && n >= 1 && n <= 100`) |
| narrowing | binds payload (`n`), narrows `r` to the variant | narrows the value to the refined type |
| disambiguation | the name is a variant of `value`'s sum | the name is a refined type whose base matches `value` |

No grammar change: `n is Quantity` already parses as a nullary pattern
(`Pattern::Variant { variant: "Quantity", bindings: [] }`). The checker decides
whether the name is a sum variant of `value`'s type or a refined type compatible
with `value`'s base (§4).

---

## 3. Grammar

**Unchanged.** `expr is Pattern` already accepts a bare name. v0.13 adds no
syntax; it gives new *meaning* to `value is Name` when `Name` resolves to a
refined type rather than a variant of `value`'s type.

---

## 4. Static semantics

### 4.1 Disambiguation in `check_is` — **[DECISION A]**

`check_is` (`checker.rs:3268`) currently requires `value`'s type to be a sum
(`Result`/`Option`/sum/`HttpResult`) and looks the pattern name up as a variant
(`karn.types.is_non_sum` / `is_unknown_variant` otherwise). v0.13 adds a
**refined-type fallback**, tried when the value is *not* a sum (or the name is not
one of its variants):

1. If the pattern is a **bare nullary name** `T`, and `T` resolves to a **refined
   type** whose base type is compatible with `value`'s type, then `value is T` is
   a **refinement check**:
   - the operator has type `Bool`;
   - in the narrowing positions (§4.2), `value` is narrowed to `T` **iff `value`
     is an identifier** (otherwise the check is still valid, but narrows nothing).
2. Otherwise the existing sum-variant rules apply unchanged.

Errors:
- `value is T` where `T` is a refined type but its base is *incompatible* with
  `value` (e.g. `s is Quantity` where `s: String`, `Quantity = Int`) →
  `karn.types.is_base_mismatch`.
- A name that is neither a variant of `value`'s type nor a base-compatible refined
  type → the existing `karn.types.is_unknown_variant` / `is_non_sum`.

**[DECISION A]** Check-time disambiguation, no grammar change (**recommended** —
reuses the existing nullary-pattern parse; the value's type already determines
intent) vs. a dedicated `Pattern::RefinedType` parsed form (needs parse-time type
knowledge the parser lacks). *Recommend: check-time.*

### 4.2 Narrowing positions

Unchanged from §2.3.6 (the existing sum-`is` narrowing): the `if`-body and the
right operand of `&&`. For refined `is`, the narrowed entry is the value's own
name re-typed to the refined type (no new binding name).

### Diagnostic codes

| Code | Status | Cause |
|---|---|---|
| `karn.types.is_base_mismatch` | **new** | `value is T` where `T` is refined but its base type is incompatible with `value` |
| `karn.types.is_unknown_variant` / `is_non_sum` | reused | name is neither a variant nor a base-compatible refined type |

---

## 5. Compilation to TypeScript — **[DECISION B]**

The runtime check reuses the per-predicate logic the `.of` constructor already
emits (`emit_pred_check`, `emitter.rs:1445`), rendered as a **boolean
expression** instead of `Result`-returning statements:

```ts
// n is Quantity  (Quantity = Int where InRange(1, 100))  →
(Number.isInteger(n) && n >= 1 && n <= 100)
```

(A new `emit_pred_check_as_bool` mirrors `emit_pred_check`; the `Int`-base
`Number.isInteger` guard and each predicate become `&&`-joined boolean terms.)

**Narrowing (full form).** A TS refined type is branded (`number & { __brand }`),
so a narrowed `n: number` used where `Quantity` is expected needs a cast — and
`const n = n as Quantity` in the branch hits a temporal-dead-zone error. The
lowering therefore:

1. lifts the value to a **receiver temp** before the `if` (reusing the v0.9.3
   `is_receiver_ref` mechanism, forced on even for simple idents in a refined
   narrowing): `const __n0 = n;`
2. uses the temp in the condition: `if (Number.isInteger(__n0) && …) {`
3. injects a **shadowing branch-entry binding** (reusing the existing
   `is`-binding injection used for variant payloads): `const n = __n0 as Quantity;`

```ts
const __n0 = n;
if (Number.isInteger(__n0) && __n0 >= 1 && __n0 <= 100) {
  const n = __n0 as Quantity;   // narrowed: branded, no TDZ (RHS reads __n0)
  // … uses of n are the branded Quantity …
}
```

**[DECISION B]** This temp-plus-shadow-cast lowering (**required for the full
form**) vs. the leaner [DECISION C](b) where refined `is` emits only the boolean
expression and performs **no** narrowing (no temp, no shadow) — the value keeps
its base type, and a refined value is still obtained via `.of` where one is
needed. The leaner form is dramatically simpler to emit and covers `assert n is
Quantity` and conditional guards; it just doesn't let you pass `n` directly to a
`Quantity` parameter inside the branch.

`tsc --strict` over the result is the gate (the branded cast must line up).

---

## 6. New test corpus

Fixture frontier: positive `163`, negative `126`. v0.13 starts at positive `164`,
negative `127`.

### Full form (option a)

Positive:
```
164_is_refined_check/        -- `n is Quantity` as a boolean (assert / condition)
165_is_refined_narrow_if/    -- narrow in an if-body, pass to a refined param
166_is_refined_narrow_and/   -- narrow in the right of `&&`
167_is_refined_in_test/      -- `assert n is Quantity` in a test case
```
Negative:
```
127_is_refined_base_mismatch/ -- `s is Quantity` where s: String, Quantity: Int
128_is_unknown_name/          -- `n is Nope` (neither variant nor refined type)
```

### Leaner form (option b)

Drop `165`/`166` (no narrowing); keep `164` (boolean), `167` (assert), and the two
negatives. Smaller, and no emitter narrowing work.

### Worked example (full form)

```karn
context demo

type Quantity = Int where InRange(1, 100)

fn double(q: Quantity) -> Int { 2 }

commons demo.check
fn classify(n: Int) -> Int {
  if n is Quantity {
    double(n)          -- n : Quantity — admitted directly
  } else {
    0
  }
}
```

*(The exact worked example is finalised against [DECISION C]; a commons-level
`fn` keeps it single-file and exercises narrow-then-use.)*

---

## 7. Implementation notes

### 7.1 Where new code goes (file:line anchors)

| Area | File | Change |
|---|---|---|
| Checker disambiguation | `checker.rs:3268` (`check_is`) | refined-type fallback; narrow the value (ident) to the refined type; `is_base_mismatch` |
| Narrowing scope | `checker.rs:3339` (`collect_is_bindings`) | for a refined `is` on an ident, add `(name, RefinedTy)` to the branch scope |
| Emission — boolean | `emitter.rs:1445` (`emit_pred_check`) → new `_as_bool` | predicate → boolean term; `lower_is` (`emitter.rs:4066`) refined arm |
| Emission — narrowing | `emitter.rs:2733` (`is_receiver_ref`), `3624` (`gather_is_bindings_for_emit`) | force a temp; inject `const name = temp as Refined` *(full form only)* |
| Diagnostics | `diagnostics.rs` | add `karn.types.is_base_mismatch` |

### 7.2 Risk areas

- **TDZ on shadowing** — the narrowed binding's RHS must read the *temp*, never
  the shadowed name (§5). This is the central correctness point of the full form.
- **Disambiguation precedence** — a sum whose variant name coincides with a
  refined type name must still resolve by the value's type (variant first when the
  value is that sum). Test both directions.
- **Non-ident values** — `f(x) is Quantity` must type-check as `Bool` and narrow
  nothing without emitting a stray binding.
- **`tsc --strict` branding** — the `as Quantity` cast on the temp must satisfy
  strict mode (it does: `number as (number & brand)` is allowed).

### 7.3 What "done" looks like

1. All v0–v0.12 fixtures pass (regression — additive).
2. New fixtures pass (per the chosen option); emitted output passes `tsc --strict`.
3. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean.
4. Tooling delta (§8) and docs delta (§9) land in the same commit.

---

## 8. Tooling delta (required)

- **tree-sitter / vscode**: **no change** — `n is Quantity` already parses as an
  `is` pattern and `is` already highlights. (The meaning is a checker concern.)
  Add a v0.13 corpus case for documentation; bump the vscode version only if other
  changes warrant it.
- **karn-fmt**: **no change** — the `is` pattern already formats. (Confirm with an
  idempotency fixture.)

This is the first increment with an almost-empty tooling delta — the feature is
semantic, not syntactic.

---

## 9. Documentation delta (required)

- **Reference** (`reference/refined-types.md`): a "narrowing with `is`" section —
  `value is RefinedType` checks the refinement and (full form) narrows; contrast
  with `.of`.
- **How-to** (`how-to/pattern-matching/narrow-with-is.md`, which exists): extend
  with refined-type narrowing.
- **Troubleshooting**: a short page for `karn.types.is_base_mismatch` (if full
  form).
- **SUMMARY / changelog**; regenerate `diagnostics.md` (+ `grammar.md` only if a
  corpus/grammar change lands); doc examples compile.

---

## 10. Decisions (resolved)

1. **[A] Disambiguation — DECIDED: check-time, no grammar change.** `value is
   Name` parses as today; the checker resolves `Name` as a sum variant of
   `value`'s type, else as a base-compatible refined type.
2. **[B] Narrowing emission — DECIDED: temp + shadow-cast.** A refined `is` lifts
   the value to a receiver temp and injects a shadowing `const name = temp as
   Refined` at branch entry (dodging the TDZ).
3. **[C] Scope — DECIDED: full `is`-narrowing.** The value (when an ident) narrows
   to the refined type in the `if`-body and `&&`-right positions, usable directly
   where the refined type is expected. Refinement *propagation* (§2.5.4) stays
   deferred.

---

## 11. v0.14+ preview

- **v0.14:** Sagas / compensation.
- **v0.15:** Cross-context capability resolution.
- **v0.16:** Multi-Worker integration testing.

Refinement **propagation** under operations (§2.5.4, "the largest design
question") remains the open refinement item; whichever option [DECISION C]
chooses, propagation is the natural place full narrowing (if deferred) rejoins —
a combined "refinement flow" increment after the MVP's inbound/coordination
surface is complete.
