# Karn v0.1 Grammar — Expressiveness Layer

A delta specification adding control flow, name bindings, and refined-value construction to the v0 compiler. Read **`karn-mvp-grammar.md`** first — this document specifies only what changes from v0. Anything not mentioned here behaves as in v0.

The v0.1 compiler should accept every v0 program unchanged. All v0 test fixtures must continue to pass. v0.1 adds new productions; it does not alter existing ones.

---

## 1. Scope

### In scope for v0.1

Additions to function bodies:

- `let` bindings with type inference.
- Block-bodied functions (sequence of statements ending in an expression).
- `if`/`else` as a value-producing expression.
- Constructor function calls on refined types (`Reps.of(value)`).
- The `?` operator for `Result` error propagation.
- `Ok(value)` and `Err(value)` as expressions for constructing `Result` values.
- The built-in `Result[T, E]` type recognised in return positions.
- The built-in `ValidationError` type used by refined-type constructors.

### Out of scope for v0.1 (deferred to v0.2+)

- User-defined sum types and record types.
- Pattern matching (`match`, `is`).
- Method calls (`value.method(args)`).
- Generic types beyond the built-in `Result` (no `Option`, no `List`).
- Opaque types in commons.
- Imports and the mixin mechanism.
- Multi-file commons.
- Documentation blocks.

The constraints from v0 carry forward: commons-only, no contexts, no agents, no capabilities, no effects.

---

## 2. Updated lexical structure

### New reserved keywords

The following are added to the reserved-keyword list:

```
else      if        let       Ok        Err       Result
```

Note: `Ok`, `Err`, and `Result` are reserved as identifiers in v0.1 because the compiler treats them specially (they are built-in expression forms and a built-in type). Users cannot declare names that collide with them.

All other lexical rules (comments, identifiers, literals, operators) remain as in v0.

---

## 3. Updated grammar

### 3.1 Function body — now a block

```
fn-decl    ::= 'fn' identifier '(' param-list? ')' '->' type-ref block

block      ::= '{' statement* expr '}'

statement  ::= let-stmt

let-stmt   ::= 'let' identifier (':' type-ref)? '=' expr
```

A function body is a brace-delimited block: zero or more statements followed by a final expression. The final expression's value is the function's return value. A v0-style single-expression body `{ expr }` is still valid — it's a block with zero statements and an expression.

Statements are terminated by a newline or by the next statement starting. No semicolons.

The `let` statement binds an identifier to the value of an expression. The type annotation is optional; if omitted, the type is inferred from the expression's type. The binding is immutable — no rebinding, no reassignment.

### 3.2 New expression forms

The expression grammar gains two new primary forms:

```
primary-expr ::= ...                            -- as in v0
              | if-expr
              | result-expr

if-expr      ::= 'if' expr block 'else' (if-expr | block)

result-expr  ::= 'Ok'  '(' expr ')'
              | 'Err' '(' expr ')'
```

The `if` expression takes a Bool condition (the discriminant) and two branches, both of which produce values of the same type. An `else if` is an `if` in the else position — desugars to nested `if-else`. The `else` branch is mandatory (no bare `if`); both branches must type-check to a common type.

`Ok` and `Err` construct `Result` values. They are keyword-introduced expression forms, not user-callable functions. The argument's type determines the `T` (for `Ok`) or `E` (for `Err`) parameter of the resulting `Result[T, E]`.

### 3.3 New postfix operators

The expression grammar gains a postfix `?` operator (higher precedence than any other postfix operator, lower than `.`):

```
postfix-expr  ::= primary-expr
               | postfix-expr '?'
               | postfix-expr '(' arg-list? ')'   -- function call (was in v0 at primary-expr)
               | postfix-expr '.' identifier      -- field access; included for future use, errors in v0.1
```

The `?` operator propagates `Result.Err` from the function it appears in. Applied to a `Result[T, E]` value, it produces a `T` if the value is `Ok(t)`; if the value is `Err(e)`, the enclosing function returns early with `Err(e)`.

Precedence note: `?` binds tighter than any binary operator and is applied left-to-right. `f()?.x` would parse as `((f())?).x` but field access is not yet meaningful in v0.1 (no records) — the parser accepts the form for forward compatibility but the type checker rejects it with a clear error.

### 3.4 New primary form — constructor call

Constructor calls use the existing function-call grammar with a qualified name:

```
primary-expr ::= ...                                       -- as before
              | qualified-fn-call

qualified-fn-call ::= identifier '.' identifier '(' arg-list? ')'
```

For example, `Reps.of(5)` is a qualified function call where `Reps` is a type name and `of` is the constructor method. v0.1 supports exactly one method per refined type: `of`. The signature is `fn TypeName.of(value: BaseType) -> Result[TypeName, ValidationError]`.

The constructor takes a value of the type's base type, applies the refinements, and returns either `Ok(refined_value)` or `Err(validation_error)`.

### 3.5 Updated full expression grammar

For reference, the v0.1 expression grammar in full (expression-level changes only):

```
expr            ::= or-expr

or-expr         ::= and-expr  ('||' and-expr)*
and-expr        ::= eq-expr   ('&&' eq-expr)*
eq-expr         ::= cmp-expr  (('==' | '!=') cmp-expr)?
cmp-expr        ::= add-expr  (('<' | '<=' | '>' | '>=') add-expr)?
add-expr        ::= mul-expr  (('+' | '-') mul-expr)*
mul-expr        ::= unary-expr (('*' | '/') unary-expr)*
unary-expr      ::= ('-' | '!') unary-expr
                  | postfix-expr

postfix-expr    ::= primary-expr postfix-op*

postfix-op      ::= '?'                              -- Result propagation
                  | '(' arg-list? ')'                -- function call
                  | '.' identifier                   -- field access (parser only in v0.1)

primary-expr    ::= integer-literal
                  | string-literal
                  | bool-literal
                  | identifier
                  | qualified-fn-call
                  | if-expr
                  | result-expr
                  | '(' expr ')'

qualified-fn-call ::= identifier '.' identifier '(' arg-list? ')'

if-expr         ::= 'if' expr block 'else' (if-expr | block)

result-expr     ::= 'Ok'  '(' expr ')'
                  | 'Err' '(' expr ')'

block           ::= '{' statement* expr '}'

statement       ::= let-stmt

let-stmt        ::= 'let' identifier (':' type-ref)? '=' expr

arg-list        ::= expr (',' expr)*
```

---

## 4. Updated static semantics

### 4.1 Name resolution

`let` bindings introduce names into a block scope. The binding is in scope from the next statement onward, including any nested blocks. A `let` does not pollute the function's parameter scope — parameter names and local `let` bindings coexist.

Shadowing rules:

- A `let` binding may shadow a parameter or earlier `let` binding in the same block. The shadowing binding produces a warning (`karn.resolve.shadowed_binding`) but compiles.
- A `let` binding cannot shadow a type name or function name declared in the commons (compile error).

Constructor calls (`Reps.of(...)`) require resolution of the type name. The first identifier (before the dot) must resolve to a declared type. The second identifier must be a recognised constructor method — in v0.1, only `of` is recognised.

### 4.2 Type checking

#### `let` bindings

For `let x: T = expr` (with annotation):

- `expr`'s type must be compatible with `T`.
- `x` is bound with type `T` in the remaining scope.

For `let x = expr` (without annotation):

- `expr`'s type becomes `x`'s type.

#### `if`/`else` expressions

For `if cond { then-block } else { else-block }`:

- `cond` must be of type `Bool`.
- Both blocks must type-check.
- The two blocks' result types must be identical (no widening, no subtyping); the `if` expression has that type.
- Mismatched branch types are a compile error.

For nested `else if`, the rule applies recursively: every branch must produce the same type.

#### Constructor calls

For `TypeName.of(value)`:

- `TypeName` must resolve to a declared refined type.
- `value`'s type must be compatible with the base type of `TypeName`.
- The expression's type is `Result[TypeName, ValidationError]`.

#### `Ok` and `Err` expressions

- `Ok(value)` has type `Result[T, E]` where `T` is `value`'s type and `E` is determined by context (typically inferred from the function's return type).
- `Err(value)` has type `Result[T, E]` where `E` is `value`'s type and `T` is determined by context.

When type inference cannot determine `T` or `E` from context, an annotation is required (typically on the `let` binding or as the function's return type).

#### `?` operator

For `expr?`:

- `expr` must have type `Result[T, E]`.
- The enclosing function's return type must be `Result[U, E]` for some `U` (the error types must match).
- The expression has type `T`.

A `?` operator outside a function with a `Result`-typed return is a compile error. A `?` on a non-`Result` value is a compile error.

#### Block typing

A block `{ stmts; expr }` has the type of `expr`. Each `let` statement is well-typed by the rule above; the final expression's type is the block's type.

A function body block's type must be compatible with the declared return type.

### 4.3 Result type representation

In v0.1, `Result[T, E]` is a built-in generic type. It is *not* declared by the user; it exists in the language. The compiler recognises:

- `Result[T, E]` as a type expression (for use in return types).
- `Ok(value)` and `Err(value)` as constructor expressions.
- `?` as the propagation operator.

`Result` cannot be used as a regular value type in v0.1 (no destructuring, no pattern matching, no method calls). The only operations are construction (`Ok`/`Err`) and propagation (`?`).

### 4.4 ValidationError representation

`ValidationError` is a built-in type used by refined-type constructors. It is a record-shaped type with the fields:

- `field: String` — the type name being constructed.
- `message: String` — a description of what failed.
- `value: ?` — the offending input value.

In v0.1, users cannot inspect `ValidationError` (no records, no pattern matching). They can construct one only indirectly, by calling a constructor that fails. The propagation pattern (`?`) is the primary way to handle it: errors flow up through `?` until they reach a function whose return type accommodates them.

`ValidationError` is reserved as a type name in v0.1.

---

## 5. Updated type system

### 5.1 Generic types

v0.1 introduces *one* generic type: `Result[T, E]`. No user-defined generics; no other built-in generics (no `Option`, no `List`). The grammar permits `Result[T, E]` as a type-ref:

```
type-ref ::= base-type
          | identifier
          | 'Result' '[' type-ref ',' type-ref ']'
```

Note that `Result` is recognised by name, not as a general generic type. v0.2 generalises this to arbitrary generic types.

### 5.2 Type compatibility (unchanged)

Refined types still widen to their base types. Other compatibility rules from v0 §6.2 are unchanged.

### 5.3 Type inference

`let` bindings without annotations infer the type from the right-hand side. This is a local inference, not full Hindley-Milner — the inference does not propagate across function boundaries.

If the right-hand side's type cannot be determined unambiguously (e.g., `let x = Ok(42)` where the `E` parameter is unconstrained), a type annotation is required.

---

## 6. Updated compilation to TypeScript

### 6.1 `let` bindings

```karn
let x: Reps = Reps.of(5)?
```

Compiles to:

```typescript
const __r0 = Reps.of(5);
if (!__r0.ok) return __r0;
const x: Reps = __r0.value;
```

The `?` operator generates an early-return on `Err`. Each `?` site introduces a fresh temporary name (`__rN`).

If there's no `?`, the lowering is direct:

```karn
let total: number = sets * reps
```

Compiles to:

```typescript
const total: number = sets * reps;
```

### 6.2 `if`/`else` expressions

`if` as an expression compiles to a ternary if it's simple, otherwise to an IIFE:

Simple form (both branches are single expressions):

```karn
if cond { a } else { b }
```

Compiles to:

```typescript
(cond ? a : b)
```

Block form (branches contain statements):

```karn
if cond { 
  let x = compute()
  x + 1
} else { 
  0 
}
```

Compiles to an IIFE:

```typescript
((): number => {
  if (cond) {
    const x = compute();
    return x + 1;
  } else {
    return 0;
  }
})()
```

The compiler picks the form based on whether the branches need statement-level code. Simple ternaries are preferred for readability.

### 6.3 Constructor calls

```karn
Reps.of(5)
```

Compiles to:

```typescript
Reps.of(5)   -- a call on the Reps constructor object
```

This is unchanged from v0 (the `of` constructor was already generated as part of the refined-type emission). v0.1 just exposes call syntax for it.

### 6.4 `?` operator

The `?` operator lowers as part of the surrounding statement context. For `let x = expr?`:

```typescript
const __r = expr;
if (!__r.ok) return __r;
const x = __r.value;
```

For `?` in an arbitrary expression position (rare in v0.1 — only at the end of a function body), the lowering creates a temporary binding even if the result isn't named:

```karn
fn validate(n: Int) -> Result[Reps, ValidationError] {
  Reps.of(n)?
}
```

Compiles to:

```typescript
export function validate(n: number): Result<Reps, ValidationError> {
  const __r0 = Reps.of(n);
  if (!__r0.ok) return __r0;
  return Ok(__r0.value);
}
```

Note the wrap in `Ok(...)` — the `?` extracted the value; the function still needs to return a `Result`.

### 6.5 `Ok` and `Err` expressions

```karn
Ok(42)
Err(someError)
```

Compile to:

```typescript
Ok(42)
Err(someError)
```

Using the runtime library's `Ok` and `Err` functions (already shipped in v0's runtime).

### 6.6 Block expressions

A block in tail position of a function body simply emits its statements followed by `return` of the final expression. Non-tail blocks (inside `if`-as-expression) compile via IIFE as described above.

---

## 7. New test corpus

The v0.1 test corpus adds fixtures for the new features. All v0 fixtures must continue to pass.

### Positive fixtures (new for v0.1)

```
tests/positive/
├── 18_let_simple/                    -- let with explicit type
├── 19_let_inferred/                  -- let without annotation
├── 20_let_chained/                   -- multiple let bindings
├── 21_if_simple/                     -- if as expression, both branches
├── 22_if_else_if/                    -- nested else-if
├── 23_constructor_call/              -- TypeName.of(value)
├── 24_question_propagation/          -- single ? in a Result-returning fn
├── 25_chained_questions/             -- multiple ? in sequence
├── 26_construct_in_if/               -- constructor inside if branch
├── 27_let_with_question/             -- let x = TypeName.of(y)?
├── 28_explicit_ok/                   -- function returning Ok(value)
├── 29_explicit_err/                  -- function returning Err(...)
├── 30_full_validator/                -- realistic validator combining everything
```

### Negative fixtures (new for v0.1)

```
tests/negative/
├── 16_let_undeclared/                -- let referencing unknown name
├── 17_if_branch_type_mismatch/       -- if/else branches with different types
├── 18_if_non_bool_cond/              -- if condition isn't Bool
├── 19_question_outside_result_fn/    -- ? in fn not returning Result
├── 20_question_on_non_result/        -- ? applied to Int
├── 21_question_error_mismatch/       -- ? where error types don't match
├── 22_constructor_wrong_base/        -- Reps.of("string") when base is Int
├── 23_unknown_constructor/           -- TypeName.foo() — only .of exists
├── 24_let_shadows_type/              -- let with name matching a declared type
├── 25_let_immutable/                 -- attempt to reassign a let binding
├── 26_invalid_generic_arg_count/     -- Result[T] (missing E)
```

### Realistic v0.1 example

The worked example for v0.1: a refined-validation commons that exercises everything new.

```karn
commons commerce.identifiers {
  type Sku       = String where Matches("[A-Z0-9]{3,16}")
  type ShortSku  = String where Matches("[A-Z0-9]{3,5}")
  type LongSku   = String where Matches("[A-Z0-9]{6,16}")
  type OrderId   = String where Matches("ORD-[0-9]{6}")
  type Quantity  = Int    where InRange(1, 9999)
  type Discount  = Int    where InRange(0, 100)

  -- Construct a Sku, validating the input
  fn parseSku(s: String) -> Result[Sku, ValidationError] {
    Sku.of(s)
  }

  -- Validate and return a quantity, with an early sanity check
  fn parseQuantity(n: Int) -> Result[Quantity, ValidationError] {
    if n < 1 {
      Err(ValidationError { 
        field: "Quantity",
        message: "must be at least 1",
        value: n,
      })
    } else {
      Quantity.of(n)
    }
  }

  -- Compose: parse a Sku, get its length classification
  fn isShortSku(s: String) -> Result[Bool, ValidationError] {
    let sku = Sku.of(s)?
    if s.length <= 5 {
      let _ = ShortSku.of(s)?
      Ok(true)
    } else {
      Ok(false)
    }
  }

  -- Apply a discount, validating both inputs
  fn applyDiscount(qty: Int, discount: Int) -> Result[Int, ValidationError] {
    let q = Quantity.of(qty)?
    let d = Discount.of(discount)?
    let amount = q * 100
    let reduction = amount * d / 100
    Ok(amount - reduction)
  }
}
```

Wait — the `parseQuantity` function uses `ValidationError { field: ..., message: ..., value: ... }` as if records exist. But records are v0.2. This is the limit of what v0.1 can express. **In v0.1, the only way to produce a `ValidationError` is for a refined-type constructor to fail.** Users cannot construct `ValidationError` values directly.

Revised function:

```karn
fn parseQuantity(n: Int) -> Result[Quantity, ValidationError] {
  -- Cannot construct ValidationError directly; rely on the constructor's check
  Quantity.of(n)
}
```

This is a real limitation of v0.1 — users have less control over error messages. Acceptable for the v0.1 scope; v0.2 with records makes user-constructed errors possible.

Similarly, `s.length` isn't possible in v0.1 (no method calls). The `isShortSku` example needs adjustment or simplification. The realistic v0.1 example is more like:

```karn
commons commerce.identifiers {
  type Sku      = String where Matches("[A-Z0-9]{3,16}")
  type Quantity = Int    where InRange(1, 9999)
  type Discount = Int    where InRange(0, 100)

  -- Simple validator
  fn parseSku(s: String) -> Result[Sku, ValidationError] {
    Sku.of(s)
  }

  -- Chained validation with `?`
  fn applyDiscount(qty: Int, discount: Int) -> Result[Int, ValidationError] {
    let q = Quantity.of(qty)?
    let d = Discount.of(discount)?
    let amount = q * 100
    let reduction = amount * d / 100
    Ok(amount - reduction)
  }

  -- Branching validation
  fn classifyQuantity(qty: Int) -> Result[String, ValidationError] {
    let q = Quantity.of(qty)?
    if q < 10 {
      Ok("small")
    } else if q < 100 {
      Ok("medium")
    } else {
      Ok("large")
    }
  }
}
```

This is the realistic shape of v0.1 commons code. The v0.2 layer (records, sums, methods) makes it dramatically more expressive.

---

## 8. Implementation notes

### 8.1 Backwards compatibility

The v0.1 compiler must accept every v0 program. The grammar additions are purely additive — no existing production is removed or altered. The single change to function-body grammar (from `{ expr }` to `{ statement* expr }`) is backward-compatible: a v0 function body `{ expr }` parses as a block with zero statements and one expression.

All v0 test fixtures must pass on the v0.1 compiler. The CI must run them as a regression check.

### 8.2 Where new code goes

In the v0 implementation structure, the additions land roughly as follows:

- `lexer.rs`: new keyword tokens (`else`, `if`, `let`, `Ok`, `Err`, `Result`, `ValidationError`), new `?` token.
- `ast.rs`: new statement and expression variants (`Let`, `If`, `Ok`, `Err`, `Question`, `ConstructorCall`, `Block`).
- `parser.rs`: new productions for `let`, `if`, constructor call, `?` postfix, Ok/Err expression.
- `resolver.rs`: handle `let` binding scope, constructor method lookup, `Ok`/`Err` keyword recognition.
- `checker.rs`: type rules for `if`, `let`, `Result[T, E]`, `?`, constructor calls, `Ok`/`Err`.
- `emitter.rs`: lowering rules for each new construct.
- `runtime/runtime.ts`: ensure `Ok`/`Err`/`Result` exports are present (they should be from v0).

### 8.3 Risk areas

- *Type inference for `Ok` and `Err`.* When the type parameters aren't determinable from context, the compiler must emit a clear error and suggest where to add an annotation. This is the new diagnostic category most likely to confuse users.
- *Error-type matching in `?`.* When the inner error type and outer return type disagree, the diagnostic must point at both the `?` site and the function signature.
- *`if` branch type unification.* When branches don't match, the diagnostic must show both branch types and where they came from.
- *Block expression typing.* The block's type comes from its tail expression; if that expression has the wrong type, the diagnostic must point at it specifically, not at the block as a whole.

### 8.4 What "done" looks like

The v0.1 compiler is done when:

1. All v0 fixtures pass unchanged.
2. All v0.1 positive fixtures (13 new) pass.
3. All v0.1 negative fixtures (11 new) produce the expected error.
4. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` are clean.
5. The v0.1 worked example (`commerce.identifiers`) compiles, type-checks, and produces TypeScript that `tsc --noEmit --strict` accepts.
6. The diagnostic quality for v0.1's new error categories is at the bar set in v0.

---

## 9. v0.2 preview (for context)

What's coming after v0.1, in roughly this order:

1. *Record types* (`type Money = record { minorUnits: Int where NonNegative, currency: CurrencyCode }`).
2. *User-defined sum types* (`type OrderError = enum { Declined | OutOfStock | InvalidCart }`).
3. *Methods on types* (`fn TypeName.method(self, ...)`).
4. *Pattern matching* (`match` expressions, `is` Boolean patterns).
5. *Built-in `Option[T]` and the wider standard generic vocabulary.*
6. *Opaque types in commons.*

These compose into the full "useful Money commons" example we sketched earlier. v0.1 is the bridge that makes function bodies expressive enough to write *something*; v0.2 makes the type system rich enough to model *real things*.
