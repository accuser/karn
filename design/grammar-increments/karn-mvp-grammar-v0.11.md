# Karn v0.11 Grammar — State Machines as Sums (Agent State Initialisers)

A delta specification giving agents **explicit initial values** for their state
fields, which makes **sum-typed state** (and opaque- / refined-typed state)
legal. This is the increment the v0.9.2 spec named and deferred: "Explicit agent
state initialiser syntax … Useful for sum-typed state, opaque-typed state, or
refined types whose refinement doesn't admit the underlying zero. Its own later
increment."

Read the earlier specs first — `karn-mvp-grammar.md` through
`karn-mvp-grammar-v0.10.md`, plus `karn-runtime-spec.md`. The v0.11 compiler
accepts every v0–v0.10 program unchanged; all prior fixtures must continue to
pass (the addition is purely additive — an optional initialiser on state
fields).

This is a **design draft for review**. Choices marked **[DECISION]** are the
language-defining calls to settle before implementation.

---

## 1. Scope

### The problem (v0.9.2 §5.3)

Since v0.9.2, every agent state field must be **zeroable** — have a defined zero
the runtime can use for a fresh key (`Int`→`0`, `Bool`→`false`, `String`→`""`,
`Option[T]`→`None`, records of zeroables). Types with **no canonical zero** are
rejected (`karn.agents.non_zeroable_state_field`):

- **sum types** — no variant is "the" zero;
- **opaque types** — the base is hidden, so the zero isn't accessible;
- **refined types whose refinement excludes the zero** — `Int where Positive`
  (0 ∉ Positive), `String where NonEmpty`.

This forces the awkward `Option[…]` workaround — `96_full_order_agent` carries
`status: Option[OrderStatus]` purely so a fresh order has *some* value (`None`),
even though "no status" is not a real state. A sum-typed **state machine** —
exactly what an order's lifecycle is — cannot be expressed directly.

### The fix — explicit state-field initialisers

A state field may declare an **initial value**. A field with an initialiser is
admissible regardless of type; a field without one falls back to the v0.9.2
implicit-zero rule. So an order agent writes its lifecycle as a real sum:

```karn
agent Order {
  key id: OrderId
  state {
    status: OrderStatus = Pending,   -- the state machine; initial state Pending
    items:  Int,                     -- extended state; implicit zero 0
  }
}
```

Once the state machine is expressible, the operations on it **already exist**:
reading the current state is `match self.state.status { … }` (exhaustiveness
checked), and a transition is `commit { ...self.state, status: Placed }` (record
spread + variant construction). v0.11 adds **only** the initialiser; it unlocks
the rest.

### In scope for v0.11

- **State-field initialisers** — `state { field: T = <static-expr>, … }`, giving
  a field an explicit initial value (§3).
- **Relaxed state validity** — a state field is admissible iff it has an
  initialiser **or** is implicitly zeroable (§4). This legalises sum-, opaque-,
  and refined-no-zero-typed state.
- **Static-expression evaluation** of the initialiser at compile time, lowered
  into the generated `__zeroOf<Name>State()` (§5).
- The worked example: an order **lifecycle state machine** as a sum (§6).

### Out of scope (deferred)

- **Transition validity / a transition table** — v0.11 lets a handler `commit`
  *any* state of the sum; it does not restrict which state→state transitions are
  legal. Legal-transition enforcement (and agent **invariants**, type-system
  §2.10.2) is a later increment.
- **Effect-derived initial values** — an initialiser that needs a capability or a
  storage read (type-system §2.7.4 "Open"). v0.11 initialisers are **static**
  (closed, pure, compile-time-constructible); see [DECISION A2].
- **Storage-kind initialisers** (`Cell[T] = expr`, `Map[K,V] = {}`) — the
  `store`-field storage kinds are still deferred (v1); this increment is about
  *value-typed* state fields only.
- **Per-field `Option` removal migration** — existing `Option[…]`-wrapped state
  keeps working; simplifying it is optional.

---

## 2. The design at a glance

| Before (v0.9.2) | After (v0.11) |
|---|---|
| `status: Option[OrderStatus]` (fresh = `None`) | `status: OrderStatus = Pending` (fresh = `Pending`) |
| sum/opaque/refined-no-zero state → compile error | legal **with** an initialiser |
| every field needs an implicit zero | every field needs an implicit zero **or** an initialiser |
| `__zeroOfState()` built from implicit zeros | `__zeroOfState()` built from initialisers, falling back to implicit zeros |

Nothing else about agents changes: `commit` still type-checks the new state
against the state type, the at-most-one-commit rule holds, and `self.state`
reads the loaded record.

---

## 3. Updated grammar

### 3.1 State-field initialisers — **[DECISION A1]**

A state field gains an optional initialiser. The recommended surface is **inline**
(`= expr` on the field), matching the type-system spec's storage-field syntax
(`Cell[T] = expr`, §2.7.4) and keeping a field's full story in one place:

```
state-field ::= identifier ':' type-ref ('where' refinement)? ('=' static-expr)?
```

```karn
state {
  status:  OrderStatus = Pending,
  retries: Int          = 3,         -- a non-zero default is fine too
  items:   Int,                       -- no initialiser → implicit zero 0
}
```

**[DECISION A1]** Inline `field: T = expr` (**recommended**) vs. a separate
`init { field: expr, … }` block (the form the v0.9.2 spec sketched). Inline is
recommended for locality (the initial value sits with the field), consistency
with the type-system storage syntax, and zero new keywords. The `init`-block
alternative separates "shape" from "initial values" but splits a field's
information across two blocks and adds a keyword. This document specifies the
inline form; swapping to `init { … }` changes only the parser and §8 tooling.

### 3.2 What is a static expression — **[DECISION A2]**

An initialiser is a **static expression**: closed and compile-time
constructible, so the emitter can lower it into the zero factory. v0.11's static
set:

- compile-time literals (`Int`/`String`/`Bool`/`()`, and unary-minus on an int
  literal), **admitted against the field's refined type** exactly as v0.9.4 Part
  A admits a literal in an expected-type position;
- value constructors over static arguments: sum **variant constructors**
  (`Pending`, `Placed(…)`), `Ok`/`Err`/`Some`/`None`, and record literals
  (`{ f: <static>, … }`);
- opaque/refined construction from a static literal (`T.unsafe(lit)` where it is
  in scope — i.e. the agent's context defines the opaque type).

**Not** static: references to `self`, handler parameters, capabilities, `<-` /
`?`, free functions, or any runtime value. Rationale: the value must exist before
any handler runs (it *is* the fresh state), so it cannot depend on runtime input.
Effect-derived initialisers are the deferred "Open" case (§1).

---

## 4. Updated static semantics

### 4.1 State-field validity

For each agent state field `name: T (= init)?`:

1. If an initialiser is present, it must be a **static expression** (§3.2),
   `karn.agents.bad_state_initialiser` otherwise; and its type must be compatible
   with `T` (the field type, with its refinement), reusing the ordinary
   expression type-check plus v0.9.4 literal admission. A type mismatch is also
   `karn.agents.bad_state_initialiser` (with a message naming both types).
2. If **no** initialiser is present, `T` must be implicitly zeroable (the v0.9.2
   rule), `karn.agents.non_zeroable_state_field` otherwise — with the note now
   reading "add an initialiser (`field: T = value`) or wrap in `Option[…]`".

So the v0.9.2 error survives but its remedy expands: a sum/opaque/refined-no-zero
field is legal the moment it carries an initialiser.

### 4.2 The state machine works for free

No new rules are needed for reading or transitioning state — these already hold
from earlier versions and are simply now reachable for sum-typed state:

- **Read:** `match self.state.status { Pending => …, Placed => …, Cancelled => … }`
  — sum pattern matching with the existing exhaustiveness / unreachable-arm
  checks. A non-exhaustive match over the states is the existing
  `karn.types.non_exhaustive_match`.
- **Transition:** `commit { ...self.state, status: Placed }` — record spread plus
  variant construction, type-checked against the state type by the existing
  `karn.commit.wrong_state_type`. The at-most-one-reachable-commit rule
  (`karn.commit.two_reachable_commits`) is unchanged.

### 4.3 Initialiser determinism

A static initialiser is evaluated once, at compile time, to a constant lowered
into the zero factory; it therefore yields the **same** fresh state for every new
key (the agent equivalent of "fresh state zero-initialises", v0.9.2 finding #10).

### Diagnostic codes

| Code | Status | Cause |
|---|---|---|
| `karn.agents.non_zeroable_state_field` | **kept**, note updated | a field with no initialiser and no implicit zero |
| `karn.agents.bad_state_initialiser` | **new** | an initialiser that is non-static, or whose type doesn't match the field |

---

## 5. Compilation to TypeScript

State emission is unchanged in shape (v0.9.2 §5.4): each agent gets a
`__zeroOf<Name>State()` factory, and `loadState` returns `stored ?? __zeroOf…()`.
The only change is **how each field's zero is produced**:

- field **with** an initialiser → lower the static expression with the existing
  expression lowerer (a sum variant becomes `{ tag: "Pending" }`, an admitted
  refined literal becomes the branded literal, a record becomes an object
  literal, `T.unsafe(lit)` stays as-is);
- field **without** an initialiser → the v0.9.2 implicit zero (`0`, `false`,
  `""`, `None`, nested zero record).

For the order example:

```typescript
function __zeroOfOrderState(): OrderState {
  return { status: { tag: "Pending" }, items: 0 };
}
```

`commit`, `loadState`, `self.state` access, and the sum/`match` lowerings are all
pre-existing (the agent's `OrderState` is already a record type whose `status`
field is the `OrderStatus` tagged union). No runtime-library change. `tsc
--strict` over the result is the gate.

> Implementation note: the static evaluator reuses v0.9.4's `const_literal` /
> admission path for the literal cases and the ordinary `lower_expr` for
> constructors — the checker just needs to (a) gate the initialiser to the static
> set, (b) type-check it against the field, and (c) hand the lowered expression to
> `agent_state_zero_record` instead of the implicit-zero lookup (`checker.rs`
> `zero_value_ts` / `agent_state_zero_record`, `emitter.rs` `__zeroOf…`).

---

## 6. New test corpus

Fixture frontier: positive `154`, negative `119`. v0.11 starts at positive `155`,
negative `120`. Agent fixtures use `target.txt = workers` where they exercise
emission; the `tsc_verify` stage gates the emitted output.

### Positive

```
155_state_sum_machine/       -- sum-typed state with an initial variant     [workers]
156_state_transition/        -- a handler that commits a state transition    [workers]
157_state_nonzero_default/   -- `retries: Int = 3` (non-zero default)        [workers]
158_state_refined_init/      -- `level: Gauge = 1` (refined-no-zero + init)  [workers]
159_order_lifecycle/         -- the §6 worked example, full lifecycle        [workers]
```

### Negative

```
120_state_initialiser_not_static/  -- `status: S = someParamOrCall`
121_state_initialiser_type_mismatch/ -- `count: Int = Pending`
122_state_sum_no_initialiser/      -- sum field, no initialiser (still an error)
```

### Migration of existing fixtures

- `96_full_order_agent` **may** be simplified from `status: Option[OrderStatus]`
  to `status: OrderStatus = Pending` (optional; both compile).
- `104_state_sum_field` (negative) is **converted to positive** by adding an
  initialiser — or kept negative as `122_state_sum_no_initialiser` demonstrates
  the no-initialiser case still errors. (Keep `104` negative; it documents that a
  bare sum field is still an error without an initialiser.)

### Worked example: an order lifecycle state machine

```karn
context commerce.orders

uses commerce.identifiers

type OrderStatus = enum { Pending, Placed, Cancelled }
type OrderError  = enum { AlreadyPlaced, AlreadyCancelled }

agent Order {
  key id: OrderId

  state {
    status: OrderStatus = Pending,   -- initial state
    items:  Int,                      -- implicit zero
  }

  on call addItem(quantity: Int) -> Effect[Result[(), OrderError]] {
    commit { ...self.state, items: self.state.items + quantity }
    Ok(())
  }

  on call place() -> Effect[Result[(), OrderError]] {
    match self.state.status {
      Pending => {
        commit { ...self.state, status: Placed }
        Ok(())
      }
      Placed    => Err(AlreadyPlaced)
      Cancelled => Err(AlreadyCancelled)
    }
  }
}
```

Exercises: sum-typed state with an initial variant; reading the state via
`match`; transitioning via `commit` with record spread; the per-state guard
(rejecting `place` unless `Pending`); and a fresh `Order` key starting at
`Pending` (not `None`).

---

## 7. Implementation notes

### 7.1 Where new code goes (file:line anchors)

| Area | File | Change |
|---|---|---|
| AST | `ast.rs` (`RecordField`, used for state fields ~`:540`) | add `init: Option<Expr>` to the state-field representation |
| Parser | `parser.rs` `parse_record_field` (~`:1802`) / the state loop in `parse_agent_decl` (~`:3433`) | parse an optional `= expr` on state fields |
| Static-expr + type-check | `checker.rs` | validate the initialiser is static, type-check vs the field; gate via a `static_expr` predicate reusing v0.9.4 `const_literal`/admission |
| Zeroability | `checker.rs` `zero_value_ts` / `agent_state_zero_record` (~`:3843`/`:3883`) | a field with an initialiser is admissible; produce its zero from the lowered initialiser, not the implicit-zero table |
| Validation | `project.rs` agent-state loop (~`:2970`) | call the new initialiser check; keep `non_zeroable_state_field` for the no-init, no-zero case |
| Diagnostics | `diagnostics.rs` | add `karn.agents.bad_state_initialiser`; update the `non_zeroable_state_field` summary/note |
| Emission | `emitter.rs` `__zeroOf<Name>State` (~`:2363`) | emit the lowered initialiser for initialised fields |

### 7.2 Risk areas

- **Static-expression gating.** The checker must reject `self`/param/capability
  references in an initialiser cleanly (a fresh-state value cannot depend on
  runtime input). Reuse the lowering context's notion of "no agent var / no
  params in scope" when checking the initialiser.
- **Refined-literal admission in initialiser position.** `level: Gauge = 1` must
  run the literal through v0.9.4 admission against `Gauge` (so `0` would be
  rejected by `Positive`, `1` admitted) — i.e. the initialiser position is an
  expected-type position for admission.
- **`commit` compatibility unchanged.** Confirm a sum-typed `status` field still
  type-checks `commit { ...self.state, status: Placed }` (it should — `status`'s
  type is the sum, unchanged by having an initialiser).
- **Opaque construction scope.** `T.unsafe(lit)` in an initialiser only works
  where `.unsafe` is in scope (the defining context); outside, it is the existing
  opaque-access error, not a new one.

### 7.3 What "done" looks like

1. All v0–v0.10 fixtures pass (regression; the addition is optional syntax).
2. New fixtures pass (5 positive, 3 negative); emitted output passes `tsc
   --strict`.
3. A fresh agent key with a sum-typed `status` initialises to the declared
   initial variant (demonstrated, as v0.9.2 demonstrated zero-init).
4. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean.
5. Tooling delta (§8) and docs delta (§9) land in the same commit.

---

## 8. Tooling delta (required)

- **tree-sitter** (`grammar.js`): the state-field rule (currently `record_field`
  reused for `state_decl`) gains an optional `= expression`. If state fields use
  the shared `record_field` rule, adding the initialiser there also (harmlessly)
  permits it on record-type fields — acceptable, or split a dedicated
  `state_field` rule. No new keyword for the inline form; `queries/highlights.scm`
  needs no new capture. Add a v0.11 corpus case; validate all fixtures parse to
  zero ERROR/MISSING.
- **vscode** (`karn.tmLanguage.json`): no change for the inline form (`=` is an
  existing operator; sum variants already highlight). Bump the extension version.
  (If [DECISION A1] picks the `init { … }` block, add `init` to the keyword set.)
- **karn-fmt** (`fmt.rs`): the state-field formatter prints the optional `= expr`
  (mirroring how a `let` initialiser is formatted). Add an idempotency fixture.

---

## 9. Documentation delta (required)

- **Reference** (`docs/src/reference/agents.md`): document state-field
  initialisers, the "initialiser **or** implicit zero" validity rule, and
  sum-typed state machines (read via `match`, transition via `commit`).
- **How-to** (`docs/src/how-to/agents/`): a new "Model an agent as a state
  machine" recipe (the §6 order lifecycle), and/or extend
  `stateful-agent.md`.
- **Explanation** (optional): a short "agents as state machines" note — why the
  state *is* a sum and transitions are commits (fits the existing explanation
  set).
- **Troubleshooting**: update the `karn.agents.non_zeroable_state_field` page (if
  present) for the new "add an initialiser" remedy; add `bad_state_initialiser`.
- **SUMMARY.md / changelog**; regenerate `diagnostics.md`, `grammar.md`,
  `keywords.md`; every fenced `karn` block compiles via the doc-example gate.

---

## 10. Decisions (resolved)

1. **[A1] Initialiser surface — DECIDED: inline `field: T = expr`.** The initial
   value sits on the field, matching the type-system storage `= expr` syntax,
   with no new keyword. (The `init { … }` block is not pursued.)
2. **[A2] Static-expression scope — DECIDED: full constructors.** Literals
   (admitted against the field's refined type per v0.9.4), sum variant
   constructors, `Ok`/`Err`/`Some`/`None`, record literals, and `T.unsafe(lit)`.
   Covers sum, refined-no-zero, and opaque state. Effect-derived initialisers stay
   deferred.
3. **[A3] Transition validity — DECIDED: defer.** v0.11 does not restrict legal
   transitions (any `commit` to any state); transition tables / agent invariants
   are a later increment.
4. **[A4] Fixture 104 — DECIDED: keep negative.** `104_state_sum_field` stays a
   negative fixture (a bare sum field with no initialiser is still an error);
   positive `155` covers the with-initialiser case.

---

## 11. v0.12+ preview

After v0.11, agents can hold real state machines. The roadmap continues:

- **v0.12:** Provider composition.
- **v0.13:** Refinement narrowing.
- **v0.14:** Sagas / compensation.
- **v0.15:** Cross-context capability resolution.
- **v0.16:** Multi-Worker integration testing.

The natural follow-ons to v0.11 — **legal-transition tables** and agent
**invariants** (type-system §2.10.2) — slot in wherever state-machine rigour next
earns its keep; they build directly on the sum-typed state this increment makes
expressible.
