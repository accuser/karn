# Karn MVP Grammar — Commons

A precise specification of the commons subset the v0 compiler must accept, type-check, and compile to TypeScript. This is the minimum viable surface that exercises the full compilation pipeline: lexing, parsing, name resolution, type checking, refinement validation, and TypeScript emission.

This document is prescriptive. The design notes carry the rationale; the type system spec carries the broader language definition. This document specifies what the v0 compiler implements.

---

## 1. Scope

### In scope for v0

A commons file containing:

- Refined value types over `Int`, `String`, and `Bool`
- Pure functions with positional parameters and single-expression bodies
- Refinement predicates from the v0 vocabulary
- Type references within the commons
- Function calls within the commons
- Arithmetic, comparison, and boolean expressions in function bodies
- Line comments
- Compilation to TypeScript with branded refined types and runtime validation

### Out of scope for v0

The following are deliberately deferred. Each is bounded — they extend the v0 grammar additively without restructuring it.

- Sum types, record types, opaque types
- Generic types (`List[T]`, `Option[T]`, `Result[T, E]`)
- `let` bindings, `if/else`, `match`, block-bodied functions
- Decimal literals, numeric separators, radix prefixes
- String interpolation, multi-line strings, multi-byte escapes
- Documentation blocks (`--- ... ---`) and block comments (`{- ... -}`)
- Imports and the mixin mechanism (`uses commerce.money`)
- Contexts, agents, services, capabilities, handlers
- Test contexts
- Private modifiers on declarations
- Type inference beyond the single-expression cascade
- Effects and the `Effect[T]` type
- Anything not listed in "In scope" above

---

## 2. Source file structure

A single source file contains exactly one commons declaration. The file extension is `.karn`. The source is UTF-8 encoded.

```
commons fitness.units {
  type Metres = Int where NonNegative
  type Reps   = Int where InRange(1, 100)
  type Sets   = Int where InRange(1, 20)

  fn totalReps(sets: Sets, reps: Reps) -> Int {
    sets * reps
  }
}
```

The file path corresponds to the commons name by convention: `commons fitness.units` lives at `src/fitness/units.karn`. The compiler may use this convention for module resolution in later versions; for v0, every input file is named on the command line.

---

## 3. Lexical structure

### 3.1 Character set

Source is UTF-8. The lexer treats characters as Unicode code points but identifiers and keywords are restricted to ASCII letters and digits (extended-character identifiers are a future addition).

### 3.2 Whitespace and newlines

Whitespace characters (space `U+0020`, tab `U+0009`, carriage return `U+000D`, line feed `U+000A`) separate tokens. Karn is not indentation-sensitive. Newlines have no syntactic significance beyond separating tokens.

### 3.3 Comments

Line comments start with `--` and extend to the end of the line.

```
-- This is a comment
type Metres = Int where NonNegative  -- inline comment
```

Block comments and documentation blocks are out of scope for v0.

### 3.4 Identifiers

An identifier starts with an ASCII letter (`a-z` or `A-Z`) and continues with letters, digits (`0-9`), or underscores (`_`).

```
identifier  ::= letter (letter | digit | '_')*
letter      ::= 'a'..'z' | 'A'..'Z'
digit       ::= '0'..'9'
```

By convention:
- Types use `PascalCase`: `Metres`, `ReserveOutcome`.
- Functions use `camelCase`: `totalReps`, `validateRange`.
- Refinement predicates use `PascalCase`: `Matches`, `InRange`.

The lexer does not enforce these conventions; they are documented for the compiler's own diagnostic output and for the standard formatter.

### 3.5 Reserved keywords

The following identifiers are reserved and cannot be used as user-defined names:

```
and       Bool      commons   false     fn        Int       
String    true      type      where
```

Refinement predicate names (`Matches`, `InRange`, `MinLength`, `MaxLength`, `Length`, `NonNegative`, `Positive`, `NonEmpty`) are not reserved keywords — they are recognised in refinement positions but can be used as identifiers elsewhere. This makes the grammar more forgiving and reduces the keyword footprint.

### 3.6 Literals

#### Integer literals

```
integer-literal ::= digit+
```

One or more decimal digits. No sign (unary `-` is a separate operator). No separators, no radix prefixes. Range: 64-bit signed integers (`-2^63` to `2^63 - 1`); values outside this range are a lexical error.

Examples: `0`, `42`, `100`, `2147483647`.

#### String literals

```
string-literal ::= '"' string-char* '"'
string-char    ::= any character except '"', '\', newline
                 | '\' escape-char
escape-char    ::= 'n' | 't' | '"' | '\\'
```

Double-quoted strings on a single line. Supported escapes: `\n` (newline), `\t` (tab), `\"` (double quote), `\\` (backslash). No interpolation.

Examples: `"hello"`, `"line1\nline2"`, `"path: \"./src\""`.

#### Boolean literals

```
bool-literal ::= 'true' | 'false'
```

### 3.7 Operators and punctuation

Multi-character operators are tokenised greedily (longest match):

```
->    ==    !=    <=    >=    &&    ||
```

Single-character operators:

```
+    -    *    /    !    =
<    >
(    )    {    }    [    ]
,    :    .
```

The colon (`:`) appears in parameter type annotations. The dot (`.`) appears in qualified names. Square brackets are reserved for future use (generics); they are not in v0 grammar but the lexer recognises them as distinct tokens.

---

## 4. Grammar

EBNF notation. Terminals in single quotes; nonterminals in lowercase-with-hyphens. `*` is zero-or-more, `+` is one-or-more, `?` is optional, `|` is alternation, parentheses group.

### 4.1 Top level

```
commons-file    ::= commons-decl

commons-decl    ::= 'commons' qualified-name '{' commons-item* '}'

qualified-name  ::= identifier ('.' identifier)*

commons-item    ::= type-decl
                  | fn-decl
```

A commons file contains exactly one `commons` declaration. The declaration's body is zero or more commons-items in any order. All top-level type and function declarations are implicitly exported (no `exports` clause in v0).

### 4.2 Type declarations

```
type-decl       ::= 'type' identifier '=' type-expr

type-expr       ::= base-type ('where' refinement)?

base-type       ::= 'Int' | 'String' | 'Bool'

refinement      ::= refinement-pred ('and' refinement-pred)*

refinement-pred ::= 'Matches'     '(' string-literal ')'
                  | 'InRange'     '(' integer-literal ',' integer-literal ')'
                  | 'MinLength'   '(' integer-literal ')'
                  | 'MaxLength'   '(' integer-literal ')'
                  | 'Length'      '(' integer-literal ')'
                  | 'NonNegative'
                  | 'Positive'
                  | 'NonEmpty'
```

A type declaration introduces a new name for a refined base type. The refinement is optional; without it, the type is structurally equivalent to its base type but distinct nominally (it gets its own brand in the compiled output).

The refinement composes one or more refinement-predicates with `and`. Each predicate constrains values of the base type; the type's values are those satisfying every predicate. Refinement predicates are restricted to the v0 vocabulary listed above.

### 4.3 Function declarations

```
fn-decl         ::= 'fn' identifier '(' param-list? ')' '->' type-ref '{' expr '}'

param-list      ::= param (',' param)*

param           ::= identifier ':' type-ref

type-ref        ::= base-type | identifier
```

A function declaration introduces a named pure function with positional parameters and a single-expression body. The return type is required. Parameter types are required and may be base types or references to types declared in the same commons.

The body is a single expression whose type must match the declared return type (or be compatible via base-type widening — see §5.4).

### 4.4 Expressions

Expression grammar uses a precedence cascade from lowest to highest:

```
expr            ::= or-expr

or-expr         ::= and-expr  ('||' and-expr)*
and-expr        ::= eq-expr   ('&&' eq-expr)*
eq-expr         ::= cmp-expr  (('==' | '!=') cmp-expr)?
cmp-expr        ::= add-expr  (('<' | '<=' | '>' | '>=') add-expr)?
add-expr        ::= mul-expr  (('+' | '-') mul-expr)*
mul-expr        ::= unary-expr (('*' | '/') unary-expr)*
unary-expr      ::= ('-' | '!') unary-expr
                  | primary-expr

primary-expr    ::= integer-literal
                  | string-literal
                  | bool-literal
                  | identifier
                  | function-call
                  | '(' expr ')'

function-call   ::= identifier '(' arg-list? ')'

arg-list        ::= expr (',' expr)*
```

**Precedence and associativity:**

- `||` and `&&` are left-associative.
- `==` and `!=` are non-associative — `a == b == c` is a syntax error.
- Comparison operators (`<`, `<=`, `>`, `>=`) are non-associative — no chained comparisons.
- `+`, `-`, `*`, `/` are left-associative.
- Unary `-` and `!` are right-associative (apply to the immediately following expression).

**Operator semantics** (covered fully in §6):

- `||`, `&&`: short-circuiting, Bool operands and result.
- `==`, `!=`: structural equality, same-type operands, Bool result.
- `<`, `<=`, `>`, `>=`: numeric or string ordering, same-type operands, Bool result.
- `+`, `-`, `*`, `/`: arithmetic on Int operands, Int result. (String concatenation with `+` is deferred to v0.1.)
- `-` (unary): negation on Int.
- `!`: logical negation on Bool.

### 4.5 Reserved future syntax

Square brackets `[` `]` are not used in v0 but are reserved for generic type parameters in v0.1 onward. The lexer produces them as tokens; the parser rejects them in any position.

---

## 5. Static semantics

Beyond the grammar, the following rules must hold for a commons file to be well-formed.

### 5.1 Name resolution

#### Type name resolution

Type names in `type-ref` position resolve as follows:

1. If the name matches a base type keyword (`Int`, `String`, `Bool`), it resolves to that base type.
2. Otherwise, search the current commons for a `type` declaration with the matching identifier. If found, the reference resolves to that declaration.
3. Otherwise, the reference is unresolved — a compile error.

Forward references are permitted within a commons: a type may reference a type declared later in the same commons.

#### Function name resolution

Function names in function-call position resolve to:

1. A `fn` declaration in the same commons with the matching identifier and a matching arity (number of parameters).
2. Otherwise, the call is unresolved — a compile error.

Forward references are permitted. Function names share a namespace with type names but are distinguished by use position (a name appearing in a `type-ref` is a type reference; in a function-call position, a function reference). Names that overlap (same identifier used for a type and a function) are a compile error.

#### Parameter name resolution

Within a function body, parameter names are in scope. They shadow any same-named type or function names defined in the commons; a parameter named `Metres` would shadow a type `Metres` (this is permitted but warned).

#### No external references

A v0 commons cannot reference anything outside itself. There is no `uses` clause yet. All references must resolve within the current commons or to a base type.

### 5.2 Type declaration well-formedness

For each `type Name = base where refinement`:

1. `Name` must not already be declared in the commons (no duplicate declarations).
2. `Name` must not be a reserved keyword.
3. `base` must be a base type (`Int`, `String`, or `Bool`).
4. The refinement (if present) must be well-formed (see §5.3).
5. Each refinement predicate must be applicable to the base type (e.g., `Matches` requires `String`; `NonNegative` requires `Int`).

#### Predicate-base compatibility

The valid combinations:

| Predicate     | Int | String | Bool |
|---------------|-----|--------|------|
| `Matches`     |     |   ✓    |      |
| `InRange`     | ✓   |        |      |
| `MinLength`   |     |   ✓    |      |
| `MaxLength`   |     |   ✓    |      |
| `Length`      |     |   ✓    |      |
| `NonNegative` | ✓   |        |      |
| `Positive`    | ✓   |        |      |
| `NonEmpty`    |     |   ✓    |      |

Predicates applied to incompatible base types are a compile error.

#### Predicate combination consistency

When multiple predicates are composed with `and`:

- For Int: predicates compose by intersection of their value sets. If the intersection is empty (e.g., `Positive and InRange(-10, -1)`), the type has no inhabitants — a compile error.
- For String: similar. `MinLength(10) and MaxLength(5)` has no valid string — a compile error.
- `Length(N) and MinLength(M)` where `M > N` is a contradiction — a compile error.
- `Length(N) and MaxLength(M)` where `M < N` is a contradiction — a compile error.
- `InRange(min, max)` requires `min <= max` — otherwise a compile error.

The compiler may not catch all contradictions in v0 (e.g., `Matches("[0-9]+") and Matches("[a-z]+")` has no inhabitants but is hard to detect statically). The cases listed above are required to be detected.

### 5.3 Refinement predicate well-formedness

Each predicate has well-formedness rules on its arguments:

- `Matches(pattern)`: `pattern` must be a valid regular expression. The regex flavour is ECMAScript-compatible (matching JavaScript's RegExp). The compiler validates the pattern at compile time and emits a precise error for invalid patterns.

- `InRange(min, max)`: both arguments are integer literals. `min <= max` is required. The range is inclusive on both bounds.

- `MinLength(n)`, `MaxLength(n)`, `Length(n)`: `n` is an integer literal. `n >= 0` is required.

- `NonNegative`, `Positive`, `NonEmpty`: no arguments.

### 5.4 Function declaration well-formedness

For each `fn name(params) -> ret { body }`:

1. `name` must not already be declared as a function in the commons (no duplicate functions).
2. `name` must not be a reserved keyword.
3. Each parameter name must be unique within the parameter list.
4. Each parameter's type must resolve (§5.1).
5. The return type must resolve.
6. The body expression must type-check (§6) and its type must be compatible with the declared return type.

### 5.5 Pure function constraint

In v0, all functions are pure by construction (no effects available in commons). The compiler doesn't need an explicit purity check — there's no way to express an effect in a v0 commons. This rule becomes relevant in later versions.

---

## 6. Type system

### 6.1 Types in v0

Three base types and any number of refined types derived from them.

```
Type ::= 'Int' | 'String' | 'Bool'
       | RefinedType(BaseType, Refinement)
       | NamedReference(identifier)   -- resolves to one of the above
```

There is no subtyping. Types are nominal — two refined types with identical structure are distinct types.

### 6.2 Type compatibility

A type `T` is **compatible** with a type `U` (T can be used where U is expected) when:

1. `T` and `U` resolve to the same type declaration, *or*
2. `U` is a base type and `T` is a refined type derived from `U` (refined types widen to their base).

Compatibility is asymmetric: `Metres` widens to `Int`, but `Int` does not narrow to `Metres`. To produce a `Metres` from an `Int`, the user must construct one (in later versions; not exercised in v0 commons function bodies, which return base types from arithmetic).

A type `T` is **assignable** to `U` only if `T` is compatible with `U`.

### 6.3 Expression typing

Expression typing is bottom-up. Each form has well-defined typing rules.

#### Literals

- Integer literals have type `Int`.
- String literals have type `String`.
- Boolean literals have type `Bool`.

#### Identifiers

The type of an identifier reference is the declared type of whatever it resolves to (a parameter has its declared type).

#### Unary operators

- `-expr` requires `expr` of type `Int` (or any refined type widening to `Int`). The result type is `Int`.
- `!expr` requires `expr` of type `Bool`. The result type is `Bool`.

#### Binary arithmetic operators (`+`, `-`, `*`, `/`)

Both operands must be of type `Int` (or refined Int). The result type is `Int`. Integer division is truncating; division by zero is a runtime error.

#### Binary comparison operators (`<`, `<=`, `>`, `>=`)

Both operands must be of the same type, either `Int` (or refined Int) or `String` (or refined String). The result type is `Bool`. String comparison is lexicographic by Unicode code point.

#### Equality operators (`==`, `!=`)

Both operands must be of the same type (any of the three base types or any refined type). The result type is `Bool`. Equality is structural.

#### Boolean operators (`&&`, `||`)

Both operands must be of type `Bool`. The result type is `Bool`. Both operators short-circuit: `&&` returns false without evaluating the right operand if the left is false; `||` returns true without evaluating the right operand if the left is true.

#### Function calls

For a call `f(arg1, arg2, ..., argN)`:

1. `f` must resolve to a declared function with N parameters.
2. Each `argI` must type-check.
3. Each `argI`'s type must be compatible with the corresponding parameter's declared type.

The result type is the function's declared return type.

#### Parenthesised expressions

`(expr)` has the same type as `expr`.

### 6.4 Function body type checking

The body expression must type-check, and its type must be compatible with the function's declared return type. Failure is a compile error.

### 6.5 Refinement propagation

Refined types widen to their base types under arithmetic and comparison operations. A function with parameters `Sets` and `Reps` (both refined `Int`) can compute `sets * reps`, which has type `Int` — not `Sets` or `Reps`. The arithmetic operators erase the refinement.

To produce a refined value, the user must construct one through the type's constructor function (covered in §7). In v0 function bodies, the only way to "produce a refined value" is to return a parameter that already has the refined type, or to use the constructor in a context that has one available — but v0 commons have no constructors callable from function bodies. So v0 functions in practice return base types.

This is a real limitation: a function `clampReps(n: Int) -> Reps` cannot construct a Reps from an Int in v0. The function can return `Int`, but not `Reps`. Constructor calls in function bodies are deferred to v0.1 (along with `let` bindings and conditionals).

---

## 7. Compilation to TypeScript

The compiler emits TypeScript that:

1. Declares each refined type as a branded type (compile-time nominal identity).
2. Provides a constructor function for each refined type that validates input at runtime.
3. Translates each commons function to a TypeScript function.
4. Bundles a small runtime library for refinement validation.

### 7.1 File structure

A commons `commerce.money` compiles to a TypeScript module:

```
src/commerce/money.karn  →  out/commerce/money.ts
```

The output module exports every commons declaration. The module imports the runtime library:

```typescript
import { Ok, Err, type Result, type ValidationError } from "@karn/runtime";
```

### 7.2 Base type mapping

| Karn | TypeScript |
|------|------------|
| `Int` | `number` (with integer constraint at refinement boundaries) |
| `String` | `string` |
| `Bool` | `boolean` |

`Int` maps to `number` because TypeScript has no separate integer type. Karn's compile-time checks ensure operations on `Int` produce integer values; runtime validation at constructor boundaries enforces integer shape on input.

### 7.3 Refined type emission

Each refined type compiles to:

1. A branded type alias for compile-time nominal identity.
2. A constructor function `of` that validates input and returns `Result<T, ValidationError>`.
3. An unsafe constructor `unsafe` that brands without validating (for internal compiler use, not user-facing).

For:

```karn
type Metres = Int where NonNegative
```

The output is:

```typescript
export type Metres = number & { readonly __brand: "Metres" };

export const Metres = {
  of(value: number): Result<Metres, ValidationError> {
    if (!Number.isInteger(value)) {
      return Err({ field: "Metres", message: "must be an integer", value });
    }
    if (value < 0) {
      return Err({ field: "Metres", message: "must be non-negative", value });
    }
    return Ok(value as Metres);
  },
  unsafe(value: number): Metres {
    return value as Metres;
  },
};
```

The `__brand` field is purely a TypeScript compile-time mechanism — it has no runtime representation. The `as Metres` cast is the only place the brand is "applied."

### 7.4 Refinement validation

Each predicate has a fixed runtime implementation in the emitted constructor:

| Predicate     | Runtime check |
|---------------|---------------|
| `NonNegative` | `value >= 0` |
| `Positive`    | `value > 0` |
| `InRange(a,b)`| `value >= a && value <= b` |
| `NonEmpty`    | `value.length > 0` |
| `MinLength(n)`| `value.length >= n` |
| `MaxLength(n)`| `value.length <= n` |
| `Length(n)`   | `value.length === n` |
| `Matches(p)`  | `new RegExp("^" + p + "$").test(value)` (anchored full-match) |

The `Matches` predicate emits the regex anchored at both ends — the full string must match. This is the most common intent and avoids surprises from partial matches.

For Int types, the constructor also validates that the input is an integer (`Number.isInteger(value)`). For String types, the constructor validates it's a string (TypeScript types help, but runtime input may come from `JSON.parse` of unknown data).

Multiple predicates are checked in source order; the first failure returns immediately with a descriptive error.

### 7.5 Function emission

Each commons function compiles to a TypeScript function with matching signature:

```karn
fn totalReps(sets: Sets, reps: Reps) -> Int {
  sets * reps
}
```

Compiles to:

```typescript
export function totalReps(sets: Sets, reps: Reps): number {
  return sets * reps;
}
```

The Karn types map directly to their TypeScript counterparts. The body is a direct transliteration: Karn operators map to TypeScript operators of the same shape.

### 7.6 Operator mapping

| Karn | TypeScript |
|------|------------|
| `+` `-` `*` `/` | `+` `-` `*` `/` |
| `==` `!=` | `===` `!==` |
| `<` `<=` `>` `>=` | `<` `<=` `>` `>=` |
| `&&` `\|\|` | `&&` `\|\|` |
| `!` | `!` |
| Unary `-` | Unary `-` |

Note `==` and `!=` map to `===` and `!==` (strict equality) — Karn equality is structural and same-type, matching the strict-equality semantics.

Division on `Int` produces a number value that may not be an integer (JavaScript `/` is floating-point). For v0, the emitted code uses `Math.trunc(a / b)` for `a / b` between Int operands, to preserve the integer-division semantics. (This is the simplest correct lowering; more efficient bitwise versions can come later.)

### 7.7 Runtime library

A small runtime library, hand-written:

```typescript
// @karn/runtime

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export interface ValidationError {
  readonly field: string;
  readonly message: string;
  readonly value: unknown;
}
```

This is the entire v0 runtime. Future versions add more (effect handling, capability resolution, agent machinery, etc.).

### 7.8 Output file structure

For input `src/fitness/units.karn`:

```
out/
├── fitness/
│   └── units.ts          -- compiled module
└── @karn/
    └── runtime.ts        -- runtime library (copied/linked)
```

The runtime is referenced by relative path during development; in production builds it would be a published package.

---

## 8. Test fixture format

The compiler is exercised through a test corpus organised by category.

### 8.1 Positive fixtures

Each positive fixture is a `.karn` file with an accompanying `.expected.ts` file:

```
tests/positive/
├── 01_minimal/
│   ├── input.karn
│   └── expected.ts
├── 02_refined_int/
│   ├── input.karn
│   └── expected.ts
└── ...
```

The test runner compiles `input.karn` and compares the output to `expected.ts`. Snapshot mismatches fail the test and surface a diff.

### 8.2 Negative fixtures

Each negative fixture is a `.karn` file with an accompanying `.expected_error` file:

```
tests/negative/
├── 01_invalid_regex/
│   ├── input.karn
│   └── expected_error.txt
└── ...
```

The `expected_error.txt` contains the expected diagnostic message (or a substring match — exact format TBD by the error infrastructure).

### 8.3 Minimum corpus

The v0 test corpus should cover:

**Positive:**

1. Single type, no functions (just a refined type declaration).
2. Refined Int with `NonNegative`.
3. Refined Int with `Positive`.
4. Refined Int with `InRange(a, b)`.
5. Refined String with `Matches`.
6. Refined String with `MinLength`.
7. Refined String with `MaxLength`.
8. Refined String with `Length`.
9. Refined String with `NonEmpty`.
10. Multiple refinements with `and`.
11. Function with one parameter.
12. Function with multiple parameters.
13. Function with arithmetic.
14. Function with comparison.
15. Function with boolean logic.
16. Function calling another function.
17. The full `fitness.units` worked example.

**Negative:**

1. Invalid regex in `Matches`.
2. `InRange(10, 5)` — inverted range.
3. `MinLength(-1)` — negative length.
4. Predicate-base mismatch (`String where NonNegative`).
5. Empty type intersection (`Int where Positive and InRange(-10, -1)`).
6. Unknown type reference.
7. Unknown function reference.
8. Wrong argument count in function call.
9. Argument type mismatch.
10. Duplicate type declaration.
11. Duplicate function declaration.
12. Return type mismatch in function body.
13. Reserved keyword as identifier.
14. Chained comparison (`a < b < c`).
15. Type used in expression position.

Each fixture serves dual purposes: regression test and documentation by example.

---

## 9. Compiler architecture (recommended)

This section is advisory rather than prescriptive — it suggests a clean shape for the v0 compiler. Other shapes are acceptable.

### 9.1 Phases

Six phases in source-to-target order:

1. **Lexing**: produce a token stream from source bytes.
2. **Parsing**: produce an AST from tokens.
3. **Name resolution**: resolve every identifier to its declaration; detect duplicates and unresolved references.
4. **Type checking**: type-check every expression; detect type mismatches and refinement well-formedness violations.
5. **Code generation**: emit TypeScript from the typed AST.
6. **Output**: write the `.ts` file and any necessary runtime support.

Each phase produces a well-defined intermediate representation. Errors are accumulated and reported at the end of each phase; the compiler continues to the next phase only if the current phase produced no errors.

### 9.2 AST shape

A suggested AST in algebraic-data-type form (Rust-like syntax):

```rust
enum CommonsItem {
    TypeDecl { name: Ident, base: BaseType, refinement: Option<Refinement>, span: Span },
    FnDecl { name: Ident, params: Vec<Param>, return_type: TypeRef, body: Expr, span: Span },
}

enum BaseType { Int, String, Bool }

struct Refinement { predicates: Vec<RefinementPred> }

enum RefinementPred {
    Matches(String),
    InRange(i64, i64),
    MinLength(i64),
    MaxLength(i64),
    Length(i64),
    NonNegative,
    Positive,
    NonEmpty,
}

struct Param { name: Ident, type_ref: TypeRef }

enum TypeRef { Base(BaseType), Named(Ident) }

enum Expr {
    IntLit(i64),
    StrLit(String),
    BoolLit(bool),
    Ident(Ident),
    Call(Ident, Vec<Expr>),
    BinOp(BinOp, Box<Expr>, Box<Expr>),
    UnaryOp(UnaryOp, Box<Expr>),
    // ...
}
```

Each node carries a `span` for source-position information used in diagnostics.

### 9.3 Diagnostics

Every error has:

- A category (`karn.lex.unexpected_character`, `karn.parse.unexpected_token`, `karn.resolve.unknown_name`, `karn.types.type_mismatch`, etc.)
- A source span (file, line, column range)
- A primary message
- Optional secondary spans and notes

The `ariadne` or `miette` crate provides the rendering. Error categories form a namespace; the v0 compiler need not implement every conceivable category, only the ones the test corpus exercises.

---

## 10. Versioning and forward compatibility

This document specifies v0. Subsequent versions (v0.1, v0.2, ...) extend the grammar and type system additively. The intent is that valid v0 programs remain valid in later versions; new features are new productions in the grammar, not changes to existing ones.

Anticipated v0.1 additions (in roughly this order):

1. `let` bindings, `if/else` expressions, `match` expressions, block-bodied functions.
2. Sum types (`type T = A | B(payload) | C`).
3. Record types (`type T = { field: U, field: V }`).
4. Constructor function calls (`Reps.of(5)?`) in expressions, enabling refined-value production.
5. Generic types (`List[T]`, `Option[T]`, `Result[T, E]`).
6. Opaque types in commons.
7. Multi-file commons (directory expansion).
8. Documentation blocks (`--- ... ---`).
9. The `uses` keyword and the mixin mechanism.

Each is a self-contained extension. The v0 compiler architecture should anticipate them without implementing them — for example, the AST should be structured so that adding `let` bindings means adding one enum variant to `Expr`, not restructuring the existing code.
