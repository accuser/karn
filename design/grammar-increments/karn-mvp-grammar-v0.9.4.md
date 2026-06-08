# Karn v0.9.4 — Refined-Construction Ergonomics & `Mock[T]`

*Draft increment spec, prepared 5 June 2026. This is the increment the v0.9.1
roadmap flagged as "the most significant language finding; its own increment,
next" (finding #7). It is a **design draft for review** — the decisions marked
**[DECISION]** are the language-defining choices that should be settled before
implementation. v0.10 (`on queue` / `on cron`) remains reserved; this lands
first.*

---

## 1. Scope

### In scope

- **Part A — Compile-time literal refinement checking.** Constructing a refined
  type from a value the compiler can check *at compile time* should not force the
  `Result` dance (`.of(...)` + `?`/match). A statically-valid construction yields
  the refined type directly; a statically-invalid one is a compile error.
- **Part B — `Mock[T]`.** A test-context-only construction operator that produces
  a value of any type `T` (refined, sum, record, opaque), with bare / literal-pin
  / variant-pin / record-override forms (type-system spec §2.10).

Part A is the foundation; Part B's literal-pin reuses Part A's checker. They can
land in that order.

### Out of scope (deferred)

- **Refinement *propagation* under operations** (type-system §2.5.4 — "the largest
  design question"). This increment checks *literals at construction*, not the
  preservation of refinements through arithmetic/slicing. `a + b` of two
  `NonNegative`s stays unrefined here.
- **Const-folding of non-literal expressions** (`Quantity.of(2 + 3)`). Only
  literals (and a unary-minus on a numeric literal) are statically evaluated in
  v0.9.4; everything else keeps the runtime `Result` path.
- **Bare `Mock[T]` for `Matches`-refined strings** — generating a string that
  satisfies an arbitrary regex is its own problem; v0.9.4 requires an explicit
  literal pin for such types (see §3.4, **[DECISION B3]**).
- `Mock[T]` for `Effect[...]`, capabilities, and storage kinds — not value types.

---

## 2. Part A — Compile-time literal refinement checking

### 2.1 The problem (finding #7)

Every refined type generates `T.of(v) -> Result[T, ValidationError]`
(type-system §2.5.3). That return type is correct for *runtime* values from
untrusted sources. But for a literal the author wrote by hand, it is pure
ceremony:

```karn
-- today: a value you can see is valid still costs a match
let q = match Quantity.of(5) {
  Ok(q)  => q
  Err(_) => ...        -- unreachable, but the compiler makes you write it
}
```

The URL-shortener fixture is littered with this; v0.9.1 §6 explicitly notes it
"will be simplified when the refined-construction increment lands."

### 2.2 The fix — **DECIDED: expected-type-directed admission**

`.of` is left exactly as it is — always `T.of(v) -> Result[T, ValidationError]`,
the runtime constructor. Instead, a **compile-time literal that appears in a
position which already expects a refined type `T`** is checked against `T`'s
refinement and admitted directly as a `T`:

- **expected `T` is refined, literal satisfies** → the literal has type `T`.
- **expected `T` is refined, literal violates** → compile error
  `karn.refine.literal_violates`, naming the failed predicate and the value.
- **no refined type expected** → the literal keeps its base type (and `.of`
  remains the way to build a `T` from a runtime value).

```karn
let q: Quantity = 5             -- 5 checked against Quantity → q : Quantity
let bad: Quantity = 0           -- compile error: 0 violates InRange(1,100)
reserve(5)                      -- param is Quantity → 5 admitted; no construction call
fn five() -> Quantity { 5 }     -- return position expects Quantity → admitted
Ok(1)                           -- inside a Result[Quantity,_] return → 1 admitted
let r = Quantity.of(userInput)  -- .of unchanged: Result[Quantity, ValidationError]
let x = 5                       -- no expected type → x : Int (annotate or use .of for a T)
```

Why this over overloading `.of` (the originally-recommended A1): `.of` keeps a
single, honest type (always `Result`), so there's no return-type-depends-on-the-
argument-form surprise and no refactoring hazard (extracting a literal into a
`let` can't silently change a type). It reuses the checker's existing
bidirectional expected-type machinery (the same path `Ok`/`Some`/`None` use), and
it is **purely additive** — it admits programs that previously failed to
type-check and changes nothing about existing code, so no fixtures need migrating
to keep passing. The cost is that it only fires where an expected type is known;
a bare `let x = 5` with no annotation stays `Int`.

The admission fires at every position that threads an expected type into the
checker: `let`/`let <-` with a type annotation, function return (block tail),
`Ok`/`Err`/`Some` payloads, and call/method arguments (so a refined-typed
parameter admits a literal argument — this is what lets construction *vanish* at
call sites).

### 2.3 What counts as a compile-time literal — **[DECISION A2]**

v0.9.4 (narrow, expandable later): integer literals, string literals, boolean
literals, `()`, and a unary minus applied directly to an integer literal
(`-1`). **Not** arithmetic on literals, **not** identifiers/consts. Rationale:
keep the static evaluator trivially correct; widen in a later increment if
wanted.

### 2.4 Predicate evaluation

All current predicates are statically evaluable against a concrete literal, and
the checker already validates predicate shapes (and carries a real regex engine
for `Matches`). The evaluator maps `(predicate, literal) → bool`:

| Predicate | Check |
|---|---|
| `NonNegative` / `Positive` | `n >= 0` / `n > 0` |
| `InRange(a, b)` | `a <= n <= b` (boundary policy per the existing checker) |
| `MinLength(k)` / `MaxLength(k)` / `Length(k)` | `len(s) >= k` / `<= k` / `== k` |
| `NonEmpty` | `len(s) > 0` |
| `Matches(re)` | `re.is_match(s)` (anchored exactly as the emitted constructor) |

Conjunctions (`p1 and p2`) must satisfy every predicate.

### 2.5 Emission

An admitted literal lowers to the **already-existing** `unsafe` constructor
(validation discharged at compile time):

```ts
// the `5` in `let q: Quantity = 5`  →
Quantity.unsafe(5)          // branded, no runtime validation, no Result
```

No new runtime surface. `tsc --strict` over the result is the correctness gate
(the value is a branded `T`, used wherever a `T` is expected).

> Implementation note (v0.9.4, in progress): the checker records the admitted
> literal's span with the refined type; the emitter wraps a literal whose
> recorded type is `Named{Refined}` in `T.unsafe(...)`. The reusable evaluator
> (`const_literal` / `eval_predicate` / `first_failed_predicate`) and the
> `karn.refine.literal_violates` diagnostic are unchanged from the earlier
> overload attempt — only the trigger moved from "a `.of` call with a literal
> arg" to "a literal in a refined-expected position".

### 2.6 Negative-int admission (deferred)

The static evaluator handles a unary minus on an integer literal, but the
checker currently only hooks admission into the int- and string-literal arms, so
`fn f() -> NegOk { -1 }` (where `NegOk = Int where InRange(-10, 0)`) is not yet
admitted. No fixture needs it; add the `UnaryOp(Neg, IntLit)` hook when a refined
type with a negative range appears.

### 2.7 "Done" for Part A

`let q: Quantity = 5` types as `Quantity`; `fn f() -> Quantity { 0 }` is a
compile error naming `InRange`; `count.call("validcode")` admits the literal
argument; `.of(runtimeVar)` is unchanged; **all prior fixtures still pass without
edits** (purely additive); the URL-shortener tests *may optionally* be simplified
to drop their literal `.of(...)` matches; new positive/negative fixtures cover
each predicate; emitted output passes `tsc --strict`.

---

## 3. Part B — `Mock[T]`

### 3.1 Surface

```
mock_expr ::= 'Mock' '[' type_ref ']' mock_arg?
mock_arg  ::= '(' expr (',' expr)* ')'        -- literal-pin or variant-pin
            | '{' field_init (',' field_init)* '}'  -- record overrides
```

`Mock` claims the `[ ... ]` syntax the parser currently reserves "for future
generics". `Mock[T]` has type `T`. It is **admitted only in test contexts**
(test-case bodies and `mocks` provider bodies); anywhere else is
`karn.mock.outside_test`.

### 3.2 Forms (type-system §2.10)

- **Bare** `Mock[T]` — fully generated (§3.4).
- **Literal pin** `Mock[T](lit)` — refined primitive pinned to `lit`; `lit` must
  satisfy the refinement (reuses Part A's evaluator) or `karn.mock.literal_violates`.
- **Variant pin** `Mock[T](Variant(args))` — sum type; same syntax as variant
  construction.
- **Record overrides** `Mock[T] { field: v, ... }` — record; named fields
  overridden, the rest generated; same syntax as record construction.

### 3.3 Generation rules (bare) — **[DECISION B3]**

| Kind of `T` | Generated value |
|---|---|
| Opaque | A synthetic, **distinct-per-call** token (`Mock[OrderId]` ≠ `Mock[OrderId]`) — e.g. a monotonic counter behind the brand. |
| Sum | First declared variant, payload fields recursively mocked. |
| Record | Each field recursively mocked. |
| Refined `Int` | Smallest in-range satisfying value (`InRange(a,b)`→`a`; `NonNegative`→`0`; `Positive`→`1`). |
| Refined `String` by length | `MinLength(k)`/`Length(k)` → `"x".repeat(k)`; `MaxLength`/`NonEmpty` → `"x"`. |
| Refined `String` by `Matches` | **Deferred** — bare `Mock[T]` on a `Matches` type is `karn.mock.needs_pin`, suggesting `Mock[T]("...")`. |
| `Bool` / `Int` / `String` (unrefined) | `true` / `0` / `""`. |

**[DECISION B3]** The `Matches`-bare deferral is the one real gap. Generating a
regex-satisfying string is a sizeable sub-problem (a constrained generator);
deferring it keeps v0.9.4 tractable and the failure is a clear, actionable error
rather than a wrong value. Alternative: pull in a regex-to-example generator now.
**Recommendation: defer.**

### 3.4 Emission

`Mock[T]` lowers to test-only runtime helpers in `runtime.ts` (a `__mock`
namespace), or to inline construction for the pinned/override forms (which are
just `T.unsafe(lit)` / variant / record construction). Opaque distinctness uses a
module-level counter. Mocks are typed identically to real values; the compiler
tags them only for diagnostics (type-system §2.10 end).

### 3.5 "Done" for Part B

Each form type-checks to `T` in a test context and is rejected outside one; bare
generation produces satisfying values for opaque/sum/record/refined-numeric/
length-refined-string; `Matches`-bare errors with a pin suggestion; literal-pin
violations error; the cart-style fixtures from the type-system spec parse and
emit; `tsc --strict` passes.

---

## 4. Test corpus (new)

Positive: literal construction per predicate (`int_inrange`, `string_minlength`,
`string_matches`, `conjunction`); negative literal (`*_violates`); `Mock` bare for
each kind; `Mock` literal/variant/record pins; URL-shortener simplified to use
direct construction. Negative: `mock_outside_test`, `mock_literal_violates`,
`mock_matches_needs_pin`, `of_non_literal_still_result` (a positive, really —
confirms the runtime path is untouched).

---

## 5. Open decisions

1. **[A1] — DECIDED: expected-type-directed admission** (§2.2). `.of` stays
   always-`Result`; literals are admitted where a refined type is expected.
   Chosen over overloading `.of` for consistency (one type for `.of`) and because
   it is non-breaking.
2. **[A2]** Literal set — confirmed "literals + unary-minus-on-int only" for
   v0.9.4 (negative-int admission hook deferred per §2.6).
3. **[B3]** Defer bare `Mock[T]` on `Matches` types (recommended) vs build a
   regex example-generator now.
4. **Sequencing** — land Part A alone first (small, high-value, unblocks the
   URL-shortener simplification), then Part B? Or ship together?
5. **Numbering** — `v0.9.4` (keeps `v0.10` reserved for queue/cron) vs folding
   into a renumber.
```
