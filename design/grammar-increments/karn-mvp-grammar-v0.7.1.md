# Karn v0.7.1 Grammar — Effect Ergonomics

A focused delta specification removing the syntactic noise of `Effect.pure(...)` wrappers in effectful function bodies. The Karn language surface stays substantively at v0.7 — no new keywords, no grammar changes, no new declaration forms. The change is a single new typing rule and a corresponding simplification in TypeScript emission.

After v0.7.1, the body of an effectful function is written as if it returns the unwrapped value type. The compiler lifts the tail expression into `Effect[T]` automatically, mirroring how TypeScript's `async function` and Rust's `async fn` allow bare return values in async bodies.

Read all earlier specs first — `karn-mvp-grammar.md` through `karn-mvp-grammar-v0.7.md`, plus `karn-runtime-spec.md` for the runtime context. The v0.7.1 compiler accepts every v0–v0.7 program unchanged (existing `Effect.pure(...)` calls still work — they're now optional in tail position rather than required).

---

## 1. Scope

### In scope

- **Tail-position auto-lift** — a block's tail expression of type `T` is automatically lifted to `Effect[T]` when the block's expected type is `Effect[T]`.
- **Bidirectional type checking refinement** — the checker propagates the expected type through `if`/`else` branches, `match` arms, and nested blocks so that auto-lift applies at every tail position, not just at the function's outermost tail.
- **Simplified TypeScript emission** — `Effect[T]` bodies emit as `async function`, and tail expressions emit as direct `return` statements without `Promise.resolve(...)` wrappers.
- **Migration of v0–v0.7 fixtures** — the test corpus is updated to use the cleaner style. Existing fixtures using `Effect.pure(...)` continue to pass; new fixtures and updated worked examples use the auto-lifted style.

### Out of scope

- **No new keywords, no grammar changes.** The lexer and parser are unchanged.
- **No change to `Effect[T]` as a type.** It remains a built-in generic.
- **No change to `<-`.** It still binds the unwrapped value from an `Effect[T]` expression.
- **No change to the infectiousness rule.** Calling effectful code from a pure context is still a compile error.
- **No removal of `Effect.pure`.** It remains in the language as an escape hatch for explicit lifting in positions where the expected type cannot be inferred.
- **No auto-await of intermediate effectful expressions.** Non-tail effectful expressions still require `<-` to be evaluated; bare effectful expressions in statement position remain disallowed (and, given Karn's existing grammar that restricts statements to `let`, `commit`, and `assert`, are already syntactically impossible).

---

## 2. The new typing rule

### 2.1 Tail-position auto-lift

For any block `{ stmts; tail }` (where the tail is the block's last expression):

- The checker determines the **expected type** of the tail from the surrounding context.
- The checker also determines the **inferred type** of the tail by type-checking it.
- If the inferred type matches the expected type, the tail is used as-is (existing behaviour).
- **If the expected type is `Effect[T]` and the inferred type is `T`, the tail is auto-lifted to `Effect[T]`** (new behaviour).
- If the inferred type is `Effect[T]` and the expected type is also `Effect[T]`, no lifting occurs (e.g., the user explicitly wrote `Effect.pure(...)` or called another effectful function in tail position).
- Otherwise (inferred and expected don't match and neither is the lift case), a type error is reported.

The rule applies at *every* block tail, including:

- The outermost function body.
- Each branch of an `if`/`else`.
- Each arm of a `match`.
- The body of any nested block.

### 2.2 Expected-type propagation

The checker performs bidirectional type checking, propagating expected types from outside in:

- A function's body has expected type equal to the declared return type.
- An `if`/`else` expression's branches each have the same expected type as the surrounding expression.
- A `match` expression's arms each have the same expected type as the surrounding expression.
- A block bound by `let x: T = { ... }` has expected type `T`.
- A block bound by `let x <- { ... }` has expected type `Effect[U]` for some `U` (the let-binding determines the inferred type for `x`).
- A function-call argument has expected type equal to the parameter's declared type.

This is standard machinery in modern type checkers. If the existing Karn checker performs bidirectional type checking partially or fully already, the change is to extend it consistently to all positions where Effect can appear.

### 2.3 Worked example: before and after

**Before (v0.7):**

```karn
service authorise {
  on call(amount: Int) -> Effect[Result[AuthId, PaymentError]] given Logger {
    let _ <- Logger.log("authorise")
    if amount == 0 {
      Effect.pure(Err(Declined))
    } else if amount > 1000000 {
      Effect.pure(Err(InsufficientFunds))
    } else {
      Effect.pure(Ok(AuthId.unsafe("AUTH-DEFAULT")))
    }
  }
}
```

**After (v0.7.1):**

```karn
service authorise {
  on call(amount: Int) -> Effect[Result[AuthId, PaymentError]] given Logger {
    let _ <- Logger.log("authorise")
    if amount == 0 {
      Err(Declined)
    } else if amount > 1000000 {
      Err(InsufficientFunds)
    } else {
      Ok(AuthId.unsafe("AUTH-DEFAULT"))
    }
  }
}
```

The function's return type is `Effect[Result[AuthId, PaymentError]]`. The if-expression's expected type is therefore `Effect[Result[AuthId, PaymentError]]`. Each branch's tail (`Err(Declined)`, `Err(InsufficientFunds)`, `Ok(...)`) has inferred type `Result[AuthId, PaymentError]`. Auto-lift applies in each branch: each value becomes `Effect[Result[AuthId, PaymentError]]`.

The pre-v0.7.1 form still type-checks: `Effect.pure(Err(Declined))` directly produces `Effect[Result[AuthId, PaymentError]]`, no lifting needed. Both forms are valid; the new form is preferred for readability.

### 2.4 Worked example: capability and provider bodies

**Before:**

```karn
capability Logger {
  fn log(msg: String) -> Effect[()]
}

provides Logger = ConsoleLogger {
  fn log(msg: String) -> Effect[()] {
    Effect.pure(())
  }
}
```

**After:**

```karn
capability Logger {
  fn log(msg: String) -> Effect[()]
}

provides Logger = ConsoleLogger {
  fn log(msg: String) -> Effect[()] {
    ()
  }
}
```

The unit value `()` (type `()`) is auto-lifted to `Effect[()]`.

### 2.5 Worked example: agent handlers

**Before:**

```karn
agent OrderEntity {
  key id: OrderId
  state { placed: Bool }
  
  on call place(amount: Money) -> Effect[Result[(), OrderError]] given Inventory {
    let stock <- Inventory.check(amount)?
    if stock {
      commit { placed: true }
      Effect.pure(Ok(()))
    } else {
      Effect.pure(Err(OutOfStock))
    }
  }
}
```

**After:**

```karn
agent OrderEntity {
  key id: OrderId
  state { placed: Bool }
  
  on call place(amount: Money) -> Effect[Result[(), OrderError]] given Inventory {
    let stock <- Inventory.check(amount)?
    if stock {
      commit { placed: true }
      Ok(())
    } else {
      Err(OutOfStock)
    }
  }
}
```

The handler's return type is `Effect[Result[(), OrderError]]`. Each branch's tail (`Ok(())`, `Err(OutOfStock)`) has type `Result[(), OrderError]`. Auto-lift wraps them.

### 2.6 Worked example: explicit Effect.pure still works

```karn
fn explicitForm() -> Effect[Int] {
  Effect.pure(5)        -- tail is Effect[Int], expected is Effect[Int]; used directly
}

fn implicitForm() -> Effect[Int] {
  5                     -- tail is Int, expected is Effect[Int]; auto-lifted
}
```

Both are valid. The implicit form is shorter and preferred. The explicit form is available when needed (rare in practice).

### 2.7 What still requires `<-`

The change is only about *tail* positions. Anywhere else, `<-` is still required to bind from an `Effect[T]`:

```karn
fn foo() -> Effect[Int] given Logger {
  let _ <- Logger.log("computing")    -- intermediate effect: <- required
  let result <- compute()              -- bind from effect: <- required
  result + 1                            -- tail: Int → auto-lift to Effect[Int]
}
```

`<-` and auto-lift are complementary: `<-` extracts T from `Effect[T]` (in non-tail positions); auto-lift inserts T into `Effect[T]` (in tail positions).

---

## 3. Updated TypeScript emission

The emitter becomes simpler, not more complex.

### 3.1 Effectful functions are async functions

A Karn function `fn foo() -> Effect[T] { body }` emits as a TypeScript `async function` returning `Promise<T>`. This was already the case from v0.5.

### 3.2 Tail expressions emit as bare returns

**Before (v0.7 emission):**

```typescript
async function authorise(amount: number, deps: Deps): Promise<Result<AuthId, PaymentError>> {
  await deps.Logger.log("authorise");
  if (amount === 0) {
    return Promise.resolve({ kind: "Err", error: { kind: "Declined" } });
  } else if (amount > 1000000) {
    return Promise.resolve({ kind: "Err", error: { kind: "InsufficientFunds" } });
  } else {
    return Promise.resolve({ kind: "Ok", value: AuthId.unsafe("AUTH-DEFAULT") });
  }
}
```

**After (v0.7.1 emission):**

```typescript
async function authorise(amount: number, deps: Deps): Promise<Result<AuthId, PaymentError>> {
  await deps.Logger.log("authorise");
  if (amount === 0) {
    return { kind: "Err", error: { kind: "Declined" } };
  } else if (amount > 1000000) {
    return { kind: "Err", error: { kind: "InsufficientFunds" } };
  } else {
    return { kind: "Ok", value: AuthId.unsafe("AUTH-DEFAULT") };
  }
}
```

The `Promise.resolve(...)` wrapper is gone. An `async function` auto-wraps its return value as `Promise<T>` — this is built into TypeScript/JavaScript semantics. No runtime difference; just cleaner output.

This applies whether the user wrote `Effect.pure(value)` or auto-lifted `value` in Karn. Both lower to bare `return value` in the emitted async function.

### 3.3 `Effect.pure(value)` in non-tail positions still emits as `Promise.resolve`

If the user explicitly writes `Effect.pure(value)` somewhere that's *not* the function's tail (e.g., inside an expression that needs an Effect value), it still emits as `Promise.resolve(value)`:

```karn
let x <- if cond { Effect.pure(5) } else { computeEffect() }
```

Emits as:

```typescript
const x = await (cond ? Promise.resolve(5) : computeEffect());
```

The `Promise.resolve` is needed here because the if-expression itself isn't in an async-function tail position.

### 3.4 Tail position detection in emission

The emitter walks the AST and determines, for each expression, whether it's in a tail position of an async function. If yes, and the expression is a non-Effect value being auto-lifted, emit it as a bare `return value;`. If yes, and the expression is already an Effect (or the user wrote `Effect.pure(...)`), still emit `return value;` but the value here is already a `Promise<T>` — the surrounding async function passes it through unchanged.

Actually, this simplifies further: in an async function, `return value` produces `Promise<T>` for non-promise `value`, and `return promise` produces `Promise<T>` for `promise: Promise<T>`. Both are valid. So the emitter doesn't need special-casing — it just emits `return expr;` in every tail position.

---

## 4. Migration of existing code

### 4.1 Test fixtures

All v0–v0.7 fixtures that use `Effect.pure(...)` in tail position should be updated to use the auto-lifted form. This is purely cosmetic — both forms type-check after v0.7.1.

The recommended migration: rewrite the worked examples (commerce.money, commerce.payment, commerce.orders, the v0.7 tests) in the auto-lifted style. They become the canonical examples in the auto-lifted style.

Existing fixtures that use `Effect.pure(...)` can be left alone if the migration is too disruptive; both forms work. The choice is between consistency (migrate all) and minimal change (leave existing alone, use the new style for new code). I'd lean toward migrating the worked examples and leaving older negative fixtures untouched.

### 4.2 Documentation and design notes

The design notes and type system spec contain examples written in the v0.7 style with `Effect.pure(...)`. These should be updated to the auto-lifted style as part of v0.7.1, so the canonical examples reflect the canonical idiom.

This is a small documentation pass — find-and-replace `Effect.pure(...)` patterns in tail position. Worth doing properly so the curriculum and self-teach materials show the clean style.

---

## 5. Implementation notes

### 5.1 Where the change goes

- **`karnc/src/checker.rs`**: the substantive change. The block-checking function needs to thread an `expected_type` parameter through. When checking a block's tail expression with an expected type that's `Effect[T]`:
  - First check the tail's inferred type.
  - If it's already `Effect[U]`, unify with `Effect[T]` (existing behaviour).
  - If it's `T`, mark the tail node as "auto-lifted" and treat the block's type as `Effect[T]`.
  - Otherwise, type error.
  
  The "auto-lifted" mark on a tail node propagates to the emitter, which uses it to decide whether to emit a value or already-wrapped expression.

  Bidirectional type checking propagates the expected type through `if`/`else` branches (each branch's expected type = the if-expression's expected type), `match` arms (same), and nested blocks (same).

- **`karnc/src/emitter.rs`**: simplification. For a tail expression in an async function, emit `return expr;` always. The runtime semantics (async function wraps return value as Promise) handles the rest. Remove any logic that previously wrapped tail values with `Promise.resolve(...)` — that's now unnecessary.

- **Fixture updates**: rewrite worked examples and the canonical positive fixtures to use the auto-lifted style. Keep some fixtures in the old style to verify backward compatibility.

### 5.2 Risk areas

- **Bidirectional checking edge cases.** Most expression positions are straightforward. The trickiest are:
  - Block-typed `let` bindings without explicit type annotations: the binding's inferred type comes from the block's tail, but auto-lift might trigger.
  - Function arguments where the parameter type is `Effect[T]` (rare in practice): a bare value of type `T` in argument position would auto-lift.
  - Match arms with mixed effectful and non-effectful branches: each arm independently auto-lifts where needed; the match's overall type unifies the arms.
  
  Test thoroughly with mixed cases.

- **Backward compatibility.** The old `Effect.pure(...)` form must continue to type-check. The new rule is *permissive* — it allows more programs, doesn't reject any. Existing tests should pass without modification.

- **Type-error message quality.** When auto-lift doesn't apply (e.g., tail is `Effect[U]` and expected is `Effect[T]` with `U ≠ T`), the error message should be clear. Don't show "auto-lift failed" as part of the error — show the underlying type mismatch.

### 5.3 What "done" looks like

1. All v0–v0.7 fixtures continue to pass (regression — old style still works).
2. New v0.7.1 fixtures using auto-lifted style pass.
3. The worked examples (commerce.money, commerce.payment, commerce.orders, tests) are rewritten in the auto-lifted style and pass.
4. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean.
5. `karnc test` on the rewritten worked examples runs and produces the same pass/fail output as before (the change is syntactic; behaviour is unchanged).
6. The emitted TypeScript is cleaner — no spurious `Promise.resolve` wrappers in tail positions.
7. Type-error messages for genuine effect mismatches remain clear.

---

## 6. New test corpus

A small set of new fixtures specifically for v0.7.1:

### Positive fixtures

```
tests/positive/
├── 111_auto_lift_simple/                       -- fn foo() -> Effect[Int] { 5 }
├── 112_auto_lift_in_branches/                  -- if/else with auto-lift in each branch
├── 113_auto_lift_in_match/                     -- match arms with auto-lift
├── 114_mixed_explicit_and_auto/                -- explicit Effect.pure in one branch,
│                                                  auto-lift in another
├── 115_auto_lift_in_handler/                   -- service handler in the new style
├── 116_auto_lift_in_agent/                     -- agent handler with auto-lift
```

### Negative fixtures

```
tests/negative/
├── 92_tail_wrong_unwrapped_type/               -- fn foo() -> Effect[Int] { "string" }
│                                                  -- tail is String, not Int; type error
├── 93_intermediate_effect_no_await/             -- non-tail Effect expression without <-
│                                                  -- (already disallowed by grammar; verify)
```

---

## 7. v0.8 preview (unchanged from v0.7's preview)

What's coming after v0.7.1:

- **Multi-Worker deployment** with runtime serialisation.
- **Additional handler kinds** (`on http`, `on queue`, `on cron`).
- **Provider composition.**
- **Cross-context capability resolution.**
- **State machines as sums.**
- **Saga / compensation machinery.**
- **Refinement narrowing.**
- **Test refinements** (parallel execution, setup/teardown, snapshots).
- **Standard library expansion.**

v0.7.1 is a small ergonomic refinement; the language's feature set is otherwise unchanged. The path forward is the same.
