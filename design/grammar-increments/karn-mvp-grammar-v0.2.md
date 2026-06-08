# Karn v0.2 Grammar — Data Shape and Operations

A delta specification adding records, sum types, methods, pattern matching, and the `Option[T]` built-in. Read **`karn-mvp-grammar.md`** (v0) and **`karn-mvp-grammar-v0.1.md`** (v0.1) first — this document specifies only what changes from v0.1. Anything not mentioned here behaves as in v0.1.

The v0.2 compiler should accept every v0 and v0.1 program unchanged. All earlier test fixtures must continue to pass. v0.2 adds new productions; it does not alter existing ones.

This is the largest single increment in the language so far. With v0.2, the Money commons we sketched earlier becomes fully expressible.

---

## 1. Scope

### In scope for v0.2

Data shape:
- **Record types** with field declarations and inline refinement.
- **Sum types** (variant types) with named variants and optional payloads.
- **Record construction** and **field access**.
- **Variant construction** for sums.

Operations:
- **Methods on types** (`fn TypeName.method(self, ...)`) for both record and sum types.
- **Static-like methods** (`fn TypeName.staticName(...)`) — no `self` parameter.
- **Method calls** via dot syntax (`value.method(args)`, `TypeName.staticName(args)`).
- **Pattern matching** via `match` expression.
- **The `is` operator** as a Boolean expression that pattern-matches.

Built-ins:
- **`Option[T]`** as a recognised built-in generic alongside `Result[T, E]`.
- **`Some(value)`** and **`None`** as expression forms.

### Out of scope for v0.2 (deferred to v0.3+)

- Opaque types (no `type T = opaque <something>` form).
- User-defined generic types (no `type Box[T] = ...`).
- Other built-in generics beyond `Result` and `Option` (no `List`, no tuples — these come with the standard library).
- Multi-file commons or directory expansion.
- Imports and the mixin mechanism (`uses` clause).
- Contexts, agents, services, capabilities, test contexts.
- Documentation blocks.
- Extension methods (defining methods on types from outside their defining commons).

The constraints from v0/v0.1 carry forward: commons-only, no contexts, no effects, no capabilities.

---

## 2. Updated lexical structure

### New reserved keywords

```
enum      match     Option    record    self      Some      None
```

`enum` and `record` are introduced for type declarations (though `enum` is not strictly required if pipe-syntax is used — see §3.2). `match` introduces pattern-matching expressions. `Option`, `Some`, and `None` are reserved because the compiler treats them as built-in. `self` is reserved as the conventional name of method receivers; `record` is reserved for record type declarations.

The previously-soft keywords `Ok`, `Err`, `Result` from v0.1 are joined by these new built-ins.

All other lexical rules are unchanged from v0.1.

---

## 3. Updated grammar

### 3.1 Record type declarations

```
type-decl       ::= 'type' identifier type-params? '=' type-expr

type-expr       ::= base-type ('where' refinement)?    -- v0
                  | record-type
                  | sum-type
                  | generic-type-ref

record-type     ::= '{' field-list? '}'

field-list      ::= field (',' field)* ','?

field           ::= identifier ':' type-ref-with-refinement

type-ref-with-refinement ::= type-ref ('where' refinement)?
```

A record type declares fields, each with a name and a type. Fields may carry inline refinement.

```
type Money = {
  minorUnits: Int where NonNegative,
  currency:   CurrencyCode,
}
```

The trailing comma after the last field is allowed.

Note: v0.2 does not include a `record` keyword (despite reserving it). Records are recognised by the brace-delimited field-list shape. The `record` keyword is reserved for potential future use (record-with-discriminator forms, named-record types, etc.).

### 3.2 Sum type declarations

```
sum-type        ::= variant-decl ('|' variant-decl)+
                  | 'enum' '{' enum-tag-list '}'

variant-decl    ::= '|' identifier ('(' field-list ')')?

enum-tag-list   ::= identifier (',' identifier)* ','?
```

Two surface forms:

**Pipe form**: each variant on its own line, prefixed with `|`. Variants may have payloads expressed as named fields:

```
type OrderStatus =
  | Pending
  | Placed(at: Timestamp, total: Money)
  | Cancelled(reason: String)
  | Fulfilled(at: Timestamp, shipment: ShipmentId)
```

**Enum form**: shorthand for simple tag-only sums (no payloads):

```
type MoneyError = enum { CurrencyMismatch, InsufficientFunds, Overflow }
```

The enum form expands to the equivalent pipe form during parsing. Both produce the same AST.

The leading `|` in the pipe form is required for every variant, including the first. This makes single-variant sums readable and parsing unambiguous.

### 3.3 Generic type references

The grammar's `type-ref` gains a generic form for the built-in generic types:

```
type-ref        ::= base-type
                  | identifier
                  | generic-type-ref

generic-type-ref ::= 'Result' '[' type-ref ',' type-ref ']'
                  | 'Option' '[' type-ref ']'
```

Note: v0.2 still does not support user-defined generic types. The only generic type references are the two built-ins.

### 3.4 Record construction and field access

Construction uses the same brace syntax as the type declaration:

```
let m = Money { minorUnits: 1000, currency: gbp }
```

Field order in construction matches declaration order is conventional but not enforced — the compiler accepts any order as long as every required field is present.

Field access via dot:

```
let amount = m.minorUnits
let cc     = m.currency
```

The grammar:

```
primary-expr    ::= ...
                  | record-construction

record-construction ::= identifier '{' field-init-list '}'

field-init-list ::= field-init (',' field-init)* ','?

field-init      ::= identifier ':' expr
                  | identifier                       -- shorthand: field-init same name as binding

postfix-op      ::= ...
                  | '.' identifier                   -- field access (was a v0.1 parse-but-reject)
```

The shorthand form (`field-init` as just `identifier`) is admitted when a binding of that name is in scope. `Money { minorUnits, currency }` constructs a Money from same-named bindings. Common enough to warrant the shorthand.

Field access in v0.2 actually does something (in v0.1 it was parser-accepted but rejected by the type checker).

### 3.5 Variant construction

Variants are constructed by name. For variants with no payload, just the name:

```
let err = CurrencyMismatch    -- variant of MoneyError
```

For variants with payloads, function-call-like syntax:

```
let pending = Pending
let placed  = Placed(at: now, total: Money { ... })
```

Variant construction uses the existing function-call grammar — variant names are recognised by the resolver as variant constructors rather than function references.

For variants where the carrier is a sum type with the variant name potentially clashing with other names, qualified construction is permitted:

```
let err = MoneyError.CurrencyMismatch
```

The qualified form is always valid; the unqualified form is admitted when unambiguous in context.

### 3.6 Method declarations

```
fn-decl         ::= 'fn' fn-name '(' param-list? ')' '->' type-ref block

fn-name         ::= identifier                            -- free function (v0)
                  | identifier '.' identifier             -- method on a type
```

The dotted form declares a method. The first identifier names the type the method is attached to (which must be a declared type in the same commons); the second identifier names the method.

Two method shapes, distinguished by the first parameter:

**Instance method** — first parameter is `self`:

```
fn Money.add(self, other: Money) -> Result[Money, MoneyError] {
  if self.currency != other.currency {
    Err(CurrencyMismatch)
  } else {
    Ok(Money {
      minorUnits: self.minorUnits + other.minorUnits,
      currency: self.currency,
    })
  }
}
```

The `self` parameter has the type the method is attached to (`Money` in this case). It's typed implicitly — the user writes `self` without a type annotation. Other parameters are typed normally.

**Static method** — no `self` parameter:

```
fn Money.zero(currency: CurrencyCode) -> Money {
  Money { minorUnits: 0, currency }
}
```

A static method on `T` is a function in `T`'s namespace, callable as `T.staticName(args)`. The constructor form `T.of(value)` from v0.1 is a static method that the language treats as built-in for refined types.

### 3.7 Method calls

Two call forms, depending on shape:

**Instance method call** — using dot on a value:

```
let result = money.add(other)
```

The receiver `money` is passed implicitly as `self`. The argument list is the rest of the parameters.

**Static method call** — using dot on the type name:

```
let z = Money.zero(gbp)
```

The grammar (unifying with the v0.1 constructor form):

```
postfix-op      ::= ...
                  | '.' identifier                                  -- field access
                  | '.' identifier '(' arg-list? ')'                -- method call

primary-expr    ::= ...
                  | identifier '.' identifier '(' arg-list? ')'     -- static method / constructor
```

Disambiguation: the compiler determines whether `T.name` is a static method call (when followed by parens) or qualified variant construction (when followed by parens and `T` is a sum type and `name` is a variant). The resolver handles this.

### 3.8 Pattern matching

```
primary-expr    ::= ...
                  | match-expr

match-expr      ::= 'match' expr '{' match-arm+ '}'

match-arm       ::= pattern '=>' expr-or-block

expr-or-block   ::= expr
                  | block

pattern         ::= variant-pattern
                  | wildcard-pattern

variant-pattern ::= identifier ('(' binding-list? ')')?

binding-list    ::= binding (',' binding)*

binding         ::= identifier                      -- bind by position
                  | identifier ':' identifier        -- bind by field name

wildcard-pattern ::= '_'
```

`match` takes a discriminant expression and a sequence of arms. Each arm is a pattern, the `=>` arrow, and an expression or block. The matched arm's body becomes the value of the match expression.

Patterns:

```
match money {
  ...
}

-- Variant with no payload
match orderStatus {
  Pending => "waiting"
  ...
}

-- Variant with positional binding  
match outcome {
  Ok(value) => useValue(value)
  Err(error) => useError(error)
}

-- Variant with named binding (matches field by name)
match placed {
  Placed(at: timestamp, total: amount) => formatReceipt(timestamp, amount)
  ...
}

-- Wildcard for "everything else"
match anything {
  Specific => doStuff()
  _ => default()
}
```

**Exhaustiveness:** The compiler checks that every variant of the discriminant's type is covered, either explicitly or via a wildcard. A non-exhaustive match is a compile error.

**Binding scope:** Bindings in a pattern are in scope only within that arm's body.

**Match value typing:** Every arm's body must produce the same type; the match expression has that type.

### 3.9 The `is` operator

```
eq-expr         ::= cmp-expr (('==' | '!=') cmp-expr)?
                  | cmp-expr 'is' pattern             -- pattern test, returns Bool
```

The `is` operator tests whether a value matches a pattern. The result is a Bool. If the pattern contains bindings, they are introduced into the scope after the `is` expression *if* it appears in a context that branches on the Boolean result (the right side of `&&`, the condition of an `if`, the discriminant of a `while` once we have loops).

Example:

```
fn isOkAndPositive(result: Result[Int, Error]) -> Bool {
  result is Ok(n) && n > 0
}
```

Here `is Ok(n)` tests that result is Ok-typed and binds `n` to the wrapped value. The `&&` short-circuits to false if `is` returns false; if true, `n` is in scope on the right.

In `if` conditions, the bindings extend into the `then` branch:

```
if result is Ok(value) {
  useValue(value)  -- value is in scope here
} else {
  handleError()
}
```

### 3.10 Option built-in

`Option[T]` is recognised by the type system. Constructors:

```
let present = Some(42)
let absent: Option[Int] = None
```

`Some(value)` produces `Option[T]` where `T` is the value's type. `None` produces `Option[T]` where `T` is determined by context (annotation, surrounding expression).

Pattern matching on Option:

```
match maybeAmount {
  Some(amount) => useAmount(amount)
  None => useDefault()
}
```

### 3.11 Updated full expression grammar

For reference, the v0.2 expression grammar in full (showing all changes):

```
expr            ::= or-expr

or-expr         ::= and-expr  ('||' and-expr)*
and-expr        ::= eq-expr   ('&&' eq-expr)*
eq-expr         ::= cmp-expr (('==' | '!=') cmp-expr)?
                  | cmp-expr 'is' pattern              -- NEW in v0.2
cmp-expr        ::= add-expr  (('<' | '<=' | '>' | '>=') add-expr)?
add-expr        ::= mul-expr  (('+' | '-') mul-expr)*
mul-expr        ::= unary-expr (('*' | '/') unary-expr)*
unary-expr      ::= ('-' | '!') unary-expr
                  | postfix-expr

postfix-expr    ::= primary-expr postfix-op*

postfix-op      ::= '?'                                -- Result propagation (v0.1)
                  | '(' arg-list? ')'                  -- function call
                  | '.' identifier                     -- field access (v0.2)
                  | '.' identifier '(' arg-list? ')'   -- method call (v0.2)

primary-expr    ::= integer-literal
                  | string-literal
                  | bool-literal
                  | identifier
                  | qualified-fn-call                  -- TypeName.staticName(args)
                  | record-construction                -- TypeName { fields }   (v0.2)
                  | if-expr                            -- v0.1
                  | result-expr                        -- Ok / Err (v0.1)
                  | option-expr                        -- Some / None (v0.2)
                  | match-expr                         -- v0.2
                  | '(' expr ')'

record-construction ::= identifier '{' field-init-list '}'

field-init-list ::= field-init (',' field-init)* ','?

field-init      ::= identifier ':' expr
                  | identifier                          -- shorthand

if-expr         ::= 'if' expr block 'else' (if-expr | block)

result-expr     ::= 'Ok'  '(' expr ')'
                  | 'Err' '(' expr ')'

option-expr     ::= 'Some' '(' expr ')'
                  | 'None'

match-expr      ::= 'match' expr '{' match-arm+ '}'

match-arm       ::= pattern '=>' expr-or-block

expr-or-block   ::= expr | block

pattern         ::= identifier ('(' binding-list? ')')?    -- variant pattern
                  | '_'                                     -- wildcard

binding-list    ::= binding (',' binding)*

binding         ::= identifier
                  | identifier ':' identifier               -- named binding

block           ::= '{' statement* expr '}'

statement       ::= let-stmt

let-stmt        ::= 'let' identifier (':' type-ref)? '=' expr

qualified-fn-call ::= identifier '.' identifier '(' arg-list? ')'

arg-list        ::= expr (',' expr)*
```

---

## 4. Updated static semantics

### 4.1 Name resolution

The resolver now handles:

- **Record types**: declared with brace-delimited field lists. Field names are scoped to the type.
- **Sum types**: declared with pipe-delimited variants. Variant names are scoped to the type; the compiler recognises them as variant constructors.
- **Method declarations**: `fn TypeName.methodName(...)` attaches the function to `TypeName`'s namespace. The compiler builds a method table per type.
- **Variant construction**: a bare variant name (e.g., `Pending`) resolves to the variant constructor when there's no ambiguity. When ambiguous, the qualified form (`OrderStatus.Pending`) is required.
- **Field access**: `expr.identifier` resolves to a field if the expression's type is a record. The field must exist on the type.
- **Method calls**: `expr.method(args)` resolves to a method on the expression's type. The method must exist; the argument count and types must match.
- **Static method calls**: `TypeName.method(args)` resolves to a static method on the type.

### 4.2 Type checking

#### Record construction

For `T { field: value, ... }`:
- `T` must be a declared record type.
- Every field in `T`'s declaration must be present (no missing fields).
- Each field's value must be compatible with the field's declared type.
- The expression's type is `T`.
- Field shorthand (`Money { minorUnits }`) requires a binding of that name in scope with a compatible type.

Constructed values are mutable-free — there is no field assignment in v0.2. A record is immutable once constructed.

#### Field access

For `expr.field`:
- `expr` must have a record type.
- The record type must declare a field with that name.
- The expression has the field's declared type.

#### Variant construction

For `Tag` (no payload):
- `Tag` must be a declared nullary variant.
- The expression's type is the sum type that owns this variant.

For `Tag(args)` (with payload):
- `Tag` must be a declared variant with payload fields.
- The arg count must match the field count.
- Each arg must be compatible with the corresponding field's type.
- The expression's type is the sum type that owns this variant.

For qualified construction `TypeName.Tag(args)`:
- `TypeName` must be a declared sum type.
- `Tag` must be a variant of `TypeName`.
- Other rules as above.

#### Method calls (instance)

For `expr.method(args)`:
- `expr` has some type `T`.
- A method `T.method` must exist, declared with `self` as first parameter.
- The method's remaining parameter types must match the args.
- The expression's type is the method's return type.

#### Method calls (static)

For `TypeName.method(args)`:
- `TypeName` must be a declared type.
- A method `TypeName.method` must exist, declared without `self` as first parameter.
- The method's parameter types must match the args.
- The expression's type is the method's return type.

For the built-in constructor form `RefinedType.of(value)`:
- This is a special static method available on every refined type.
- The value type must match the refined type's base.
- Returns `Result[RefinedType, ValidationError]`.

#### `match` expressions

For `match expr { arm1, arm2, ... }`:
- `expr` has some type `T`. `T` should be a sum type, an Option, a Result, or a Bool (matching the value's variants).
- Each arm's pattern must be valid for type `T`:
  - Variant patterns must match variants of `T`.
  - Bindings in the pattern get the corresponding field types.
- Each arm's body type-checks to the same type `U`.
- The match expression has type `U`.
- The set of arms must be exhaustive (every variant of `T` covered, or a wildcard arm). Non-exhaustive match is a compile error.

#### `is` operator

For `expr is pattern`:
- `expr` has some type `T`.
- `pattern` must be a valid pattern for `T`.
- The expression's type is `Bool`.
- Pattern bindings are introduced into scope according to the rules in §3.9 (within the truthy branch of `&&`, within `if` then-branches, etc.).

#### `Some` and `None`

- `Some(value)` has type `Option[T]` where `T` is `value`'s type.
- `None` has type `Option[T]` where `T` is determined by context. When context is insufficient, an annotation is required.

#### Method body type-checking

A method body type-checks like any function body. The `self` parameter has the type the method is attached to. Field access on `self` and recursive method calls on `self` are standard.

### 4.3 Exhaustiveness for `match`

For a sum type `T = | A | B(x) | C(y, z)`, a `match expr` on a `T` value must have arms covering:
- The variant `A`
- The variant `B` (with any binding)
- The variant `C` (with any bindings)

Or alternatively, a wildcard arm `_ => ...` that handles any unmentioned variants.

The wildcard arm must be last (no arms after it; everything after is unreachable).

For `Option[T]`, both `Some(...)` and `None` must be covered.
For `Result[T, E]`, both `Ok(...)` and `Err(...)` must be covered.

Reachability: the compiler should warn (or error) when an arm is unreachable because a previous arm already covered everything.

---

## 5. Updated type system

### 5.1 Nominal record and sum types

Record and sum types are nominal — two types with identical declarations are distinct types. `type A = { x: Int }` and `type B = { x: Int }` are not interchangeable.

### 5.2 Refinement on record fields

Record field types may carry inline refinement:

```
type Money = {
  minorUnits: Int where NonNegative,
  currency:   CurrencyCode,
}
```

The compiler enforces refinement at construction time: `Money { minorUnits: -5, currency: gbp }` is a compile-time error (when `minorUnits` is a literal) or a runtime constructor error (when it's a dynamic value).

For runtime values, the constructor approach is via the built-in `Money.of(...)` method which validates and returns `Result[Money, ValidationError]`. The bare construction syntax `Money { ... }` either has compile-time-known-valid values or fails at runtime — there is no Result wrapping.

In practice: users construct with `Money.of(...)?` for validated production; bare construction is used when all values are statically known to satisfy refinements (e.g., inside a method body where `self.minorUnits` is already a `MinorUnits` value).

### 5.3 The built-in `Option[T]` type

`Option[T]` is a sum type, defined conceptually as:

```
type Option[T] = | Some(value: T) | None
```

It is not user-declared. Constructors `Some(...)` and `None` are recognised by the compiler. Pattern matching and `is` work on Option as on any sum.

### 5.4 Method dispatch

Method dispatch is static: `expr.method(args)` is resolved at compile time based on `expr`'s type. There is no runtime polymorphism, no virtual dispatch, no type classes.

Method tables are built per type at compile time. Each type has:
- A set of instance methods (each with `self` parameter).
- A set of static methods (no `self`).
- For refined types, the implicit `of` constructor.

Method lookup: for `expr.method(args)`, find `expr.Type.method` (instance methods); for `TypeName.method(args)`, find `TypeName.method` (static methods). No fallback, no inheritance.

---

## 6. Updated compilation to TypeScript

### 6.1 Record types

A record type compiles to:

1. A TypeScript interface for the type.
2. A namespace object for the type's methods.
3. A constructor pattern if there's an `of` static method (for refined types).

```karn
type Money = {
  minorUnits: Int where NonNegative,
  currency:   CurrencyCode,
}

fn Money.zero(currency: CurrencyCode) -> Money {
  Money { minorUnits: 0, currency }
}

fn Money.add(self, other: Money) -> Result[Money, MoneyError] {
  if self.currency != other.currency {
    Err(CurrencyMismatch)
  } else {
    Ok(Money { minorUnits: self.minorUnits + other.minorUnits, currency: self.currency })
  }
}
```

Compiles to:

```typescript
export interface Money {
  readonly minorUnits: number;
  readonly currency: CurrencyCode;
}

export const Money = {
  // Static methods including the implicit refinement-aware constructor
  zero(currency: CurrencyCode): Money {
    return { minorUnits: 0, currency };
  },
  
  // Instance methods compiled as functions that take `self` explicitly
  add(self: Money, other: Money): Result<Money, MoneyError> {
    if (self.currency !== other.currency) {
      return Err(CurrencyMismatch);
    } else {
      return Ok({ 
        minorUnits: self.minorUnits + other.minorUnits, 
        currency: self.currency 
      });
    }
  },
};
```

Instance method calls `money.add(other)` lower to `Money.add(money, other)` at the call site:

```typescript
const result = Money.add(money, other);
```

Static method calls `Money.zero(gbp)` lower directly:

```typescript
const z = Money.zero(gbp);
```

Field access lowers directly:

```typescript
const amount = m.minorUnits;
```

### 6.2 Sum types

A sum type compiles to:

1. A discriminated union type in TypeScript.
2. A namespace object with variant constructors.

```karn
type MoneyError = enum { CurrencyMismatch, InsufficientFunds, Overflow }

type OrderStatus =
  | Pending
  | Placed(at: Timestamp, total: Money)
  | Cancelled(reason: String)
```

Compiles to:

```typescript
export type MoneyError = 
  | { readonly tag: "CurrencyMismatch" }
  | { readonly tag: "InsufficientFunds" }
  | { readonly tag: "Overflow" };

export const MoneyError = {
  CurrencyMismatch: { tag: "CurrencyMismatch" } as MoneyError,
  InsufficientFunds: { tag: "InsufficientFunds" } as MoneyError,
  Overflow: { tag: "Overflow" } as MoneyError,
};

export type OrderStatus = 
  | { readonly tag: "Pending" }
  | { readonly tag: "Placed"; readonly at: Timestamp; readonly total: Money }
  | { readonly tag: "Cancelled"; readonly reason: string };

export const OrderStatus = {
  Pending: { tag: "Pending" } as OrderStatus,
  Placed: (at: Timestamp, total: Money): OrderStatus => 
    ({ tag: "Placed", at, total }),
  Cancelled: (reason: string): OrderStatus => 
    ({ tag: "Cancelled", reason }),
};
```

Variant construction `Pending` and `Placed(at, total)` lowers to:

```typescript
const a = OrderStatus.Pending;
const b = OrderStatus.Placed(now, money);
```

(The compiler generates the qualifying namespace prefix at lowering time.)

### 6.3 `match` expressions

A match lowers to a `switch` on the discriminant tag, with each arm as a `case`:

```karn
match status {
  Pending => "waiting"
  Placed(at: t, total: amt) => formatOrder(t, amt)
  Cancelled(reason: r) => "cancelled: " + r
}
```

Compiles (in expression position) to an IIFE with a switch:

```typescript
((__d) => {
  switch (__d.tag) {
    case "Pending": return "waiting";
    case "Placed": return formatOrder(__d.at, __d.total);
    case "Cancelled": return "cancelled: " + __d.reason;
    default: throw new Error("non-exhaustive match");  // unreachable if exhaustive
  }
})(status)
```

For matches in tail position of a function body, the IIFE can be elided:

```typescript
switch (status.tag) {
  case "Pending": return "waiting";
  case "Placed": return formatOrder(status.at, status.total);
  case "Cancelled": return "cancelled: " + status.reason;
}
```

The compiler picks the form based on whether match appears in tail position.

### 6.4 `is` operator

The `is` operator lowers to a tag check:

```karn
if result is Ok(value) { useValue(value) } else { handleErr() }
```

Compiles to:

```typescript
if (result.tag === "Ok") {
  const value = result.value;
  useValue(value);
} else {
  handleErr();
}
```

The pattern's bindings become `const` declarations in the truthy branch.

For `is` in a non-branching position (e.g., as the value of a let binding):

```karn
let isOk = result is Ok(_)
```

Compiles to:

```typescript
const isOk = result.tag === "Ok";
```

### 6.5 `Option` and `Some`/`None`

`Option[T]` is a sum type discrimination just like user-defined sums. Its constructors:

```typescript
export type Option<T> = 
  | { readonly tag: "Some"; readonly value: T }
  | { readonly tag: "None" };

export const Some = <T>(value: T): Option<T> => ({ tag: "Some", value });
export const None: Option<never> = { tag: "None" };
```

Pattern matching and `is` on Option works identically to user-defined sums.

### 6.6 Method calls — UFCS style

Method calls compile to namespace function calls with the receiver as the first argument:

```karn
money.add(other)
money.add(other).unwrap()
```

Compile to:

```typescript
Money.add(money, other);
Money.unwrap(Money.add(money, other));  // chained
```

(The `unwrap` here is hypothetical — Result.unwrap would be in the runtime. The point is the lowering pattern.)

This is uniform function call syntax: `value.method(args)` is sugar for `Type.method(value, args)`. The compiler does this transformation at lowering time.

---

## 7. New test corpus

The v0.2 test corpus adds substantial coverage. All v0 and v0.1 fixtures must continue to pass.

### Positive fixtures (new for v0.2)

```
tests/positive/
├── 31_simple_record/             -- declare a record, construct it, access fields
├── 32_record_with_refinement/    -- record fields with refinement
├── 33_simple_sum/                -- enum-style sum, no payloads
├── 34_sum_with_payloads/         -- pipe-style sum with variant payloads
├── 35_record_construction_shorthand/ -- Money { minorUnits, currency }
├── 36_static_method/             -- TypeName.staticMethod(args)
├── 37_instance_method/           -- value.method(args)
├── 38_method_self_field_access/  -- self.field within a method
├── 39_match_simple/              -- match on simple sum
├── 40_match_with_bindings/       -- match with positional bindings
├── 41_match_with_named_bindings/ -- match with field-name bindings
├── 42_match_with_wildcard/       -- match with _ catch-all
├── 43_is_operator/               -- value is Pattern in expression
├── 44_is_with_if/                -- if value is Pattern { use binding }
├── 45_option_some_none/          -- construct and match on Option
├── 46_money_basic/               -- Money commons with construction
├── 47_money_methods/             -- Money commons with add, subtract
├── 48_money_match_errors/        -- match on MoneyError variants
├── 49_full_money_commons/        -- complete Money commons (worked example)
```

### Negative fixtures (new for v0.2)

```
tests/negative/
├── 27_record_missing_field/      -- Money { minorUnits: 1 } (currency missing)
├── 28_record_extra_field/        -- Money { x: 1, y: 2, extra: 3 }
├── 29_field_access_on_non_record/ -- 5.foo
├── 30_unknown_field/             -- money.unknownField
├── 31_sum_unknown_variant/       -- MoneyError.NotAVariant
├── 32_variant_wrong_arity/       -- Placed(at) when Placed takes (at, total)
├── 33_match_non_exhaustive/      -- match missing variants without wildcard
├── 34_match_branch_type_mismatch/ -- arms with different types
├── 35_match_unreachable_arm/     -- wildcard before specific variant
├── 36_is_invalid_pattern/        -- is with pattern not matching type
├── 37_method_not_found/          -- value.noSuchMethod()
├── 38_method_arg_count/          -- value.method(too, many) or missing args
├── 39_static_method_on_value/    -- money.zero() instead of Money.zero()
├── 40_record_recursive_field/    -- type A = { f: A } (no, infinite type)
├── 41_self_outside_method/       -- self referenced in a free function
```

### v0.2 worked example: the Money commons

The realistic worked example for v0.2 is the full Money commons we sketched earlier:

```karn
commons commerce.money {
  type CurrencyCode = String where Matches("[A-Z]{3}")

  type Money = {
    minorUnits: Int where NonNegative,
    currency:   CurrencyCode,
  }

  type MoneyError = enum {
    CurrencyMismatch,
    InsufficientFunds,
    Overflow,
  }

  -- Static constructor
  fn Money.of(minorUnits: Int, currency: String) -> Result[Money, MoneyError] {
    let curCode = CurrencyCode.of(currency)?
    if minorUnits < 0 {
      Err(InsufficientFunds)
    } else {
      Ok(Money { minorUnits: minorUnits, currency: curCode })
    }
  }

  fn Money.zero(currency: CurrencyCode) -> Money {
    Money { minorUnits: 0, currency }
  }

  fn Money.add(self, other: Money) -> Result[Money, MoneyError] {
    if self.currency != other.currency {
      Err(CurrencyMismatch)
    } else {
      Ok(Money { 
        minorUnits: self.minorUnits + other.minorUnits, 
        currency: self.currency,
      })
    }
  }

  fn Money.subtract(self, other: Money) -> Result[Money, MoneyError] {
    if self.currency != other.currency {
      Err(CurrencyMismatch)
    } else if self.minorUnits < other.minorUnits {
      Err(InsufficientFunds)
    } else {
      Ok(Money { 
        minorUnits: self.minorUnits - other.minorUnits, 
        currency: self.currency,
      })
    }
  }

  fn Money.multiplyBy(self, factor: Int) -> Money {
    Money { 
      minorUnits: self.minorUnits * factor, 
      currency: self.currency,
    }
  }

  fn Money.equals(self, other: Money) -> Bool {
    self.currency == other.currency && self.minorUnits == other.minorUnits
  }

  fn Money.lessThan(self, other: Money) -> Result[Bool, MoneyError] {
    if self.currency != other.currency {
      Err(CurrencyMismatch)
    } else {
      Ok(self.minorUnits < other.minorUnits)
    }
  }

  fn Money.isZero(self) -> Bool {
    self.minorUnits == 0
  }
}
```

This compiles, type-checks, and produces TypeScript that `tsc --noEmit --strict` accepts.

---

## 8. Implementation notes

### 8.1 Backwards compatibility

All v0 and v0.1 fixtures must pass on the v0.2 compiler. The grammar additions are additive. The handling of `.identifier` postfix is updated from "parser-accepted but rejected" (v0.1) to fully supported (v0.2).

### 8.2 Where new code goes

In the existing implementation structure:

- `lexer.rs`: new keyword tokens (`enum`, `match`, `Option`, `record`, `self`, `Some`, `None`).
- `ast.rs`: significant new variants:
  - `TypeExpr::Record(Vec<Field>)`, `TypeExpr::Sum(Vec<Variant>)`, `TypeExpr::GenericRef(...)`.
  - `Expr::RecordConstruction(Ident, Vec<FieldInit>)`, `Expr::FieldAccess(Box<Expr>, Ident)`.
  - `Expr::MethodCall(Box<Expr>, Ident, Vec<Expr>)`, `Expr::StaticMethodCall(Ident, Ident, Vec<Expr>)`.
  - `Expr::Match(Box<Expr>, Vec<MatchArm>)`, `Expr::Is(Box<Expr>, Pattern)`.
  - `Expr::Some(Box<Expr>)`, `Expr::None`.
  - `FnName::Method(Ident, Ident)` variant for method declarations.
- `parser.rs`: new productions for records, sums, methods, match, is, Option, field access, method calls.
- `resolver.rs`: substantially expanded — method tables, variant constructors, field references.
- `checker.rs`: largest addition — record/sum type checking, method dispatch, pattern type checking, exhaustiveness.
- `emitter.rs`: lowering rules for each new construct, especially the discriminated-union representation and UFCS lowering.

### 8.3 Risk areas

- **Exhaustiveness checking for `match`.** This is the most complex new check. The algorithm: for each arm, compute the set of values it covers (variants of the sum); the union of all arms' covered sets must equal the full set of variants for the discriminant's type, or there must be a wildcard arm.

- **Method resolution precedence.** When `expr.method(args)` is called, the resolver looks up the method on the expression's type. If `expr.method` could be either a field access (a function-valued field) or a method call, the call form (with parens) disambiguates. The resolver should produce a clear error if neither matches.

- **Variant name disambiguation.** When two sum types declare variants with the same name (e.g., both `Pending` and `Pending` in different sums), unqualified construction is ambiguous. The compiler must require qualified construction (`OrderStatus.Pending`) in such cases.

- **`Some`/`None` type inference.** `let x = None` cannot infer `Option[?]` without context. The compiler must require an annotation in such cases, with a clear diagnostic.

- **Refinement on record fields at construction time.** When `Money { minorUnits: -5, ... }` is written with a literal that violates the refinement, the compiler can catch this at compile time. For dynamic values, the constructor `Money.of(...)` does runtime checking. Both should produce useful errors.

### 8.4 What "done" looks like

1. All v0, v0.1 fixtures pass (regression).
2. All v0.2 fixtures (19 positive, 15 negative) pass.
3. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` are clean.
4. The Money commons worked example compiles, type-checks, and emits TypeScript that `tsc --noEmit --strict` accepts.
5. Diagnostic quality for v0.2's new error categories matches v0/v0.1.

---

## 9. v0.3 preview (for context)

What's likely coming after v0.2:

1. *Opaque types in commons* — types whose representation is hidden but identity is preserved.
2. *Multi-file commons* — directory-expansion convention for commons spread across files.
3. *Imports between commons* — `uses` clauses among commons (commons-to-commons composition).
4. *Documentation blocks* (`---`) — first-class documentation associated with declarations.

v0.4 and beyond:

1. Contexts as a declaration kind.
2. Agents within contexts.
3. Services within contexts.
4. Capabilities and `given` clauses.
5. The mixin mechanism (context-uses-commons).
6. Test contexts (the third kind).

After v0.2, the language has a complete commons surface — useful for pure-data libraries, validation, formatting, calculations. The architecture proper (contexts and beyond) begins in v0.4.
