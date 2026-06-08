# Karn v0.3 Grammar — Commons Layer Completion

A delta specification adding opaque types, documentation blocks, the `uses` mechanism among commons, and multi-file commons via directory expansion. Read **`karn-mvp-grammar.md`** (v0), **`karn-mvp-grammar-v0.1.md`** (v0.1), and **`karn-mvp-grammar-v0.2.md`** (v0.2) first — this document specifies only what changes from v0.2.

The v0.3 compiler should accept every v0, v0.1, and v0.2 program unchanged. All earlier test fixtures must continue to pass. v0.3 adds new productions and a new file organisation; it does not alter the meaning of existing constructs.

After v0.3, the commons layer is complete. A real-world commons library — with documentation, opaque types where representation hiding matters, multi-file organisation, and composition via `uses` — becomes expressible. v0.4 will begin the architectural layer: contexts.

---

## 1. Scope

### In scope for v0.3

Source organisation:
- **Headerless commons declarations** — a file can start with `commons commerce.money` (no braces) followed by top-level declarations.
- **Multi-file commons** — a single commons can span multiple `.karn` files in a directory.
- **Commons-to-commons `uses`** — a commons can mix in another commons's declarations.

Type system:
- **Opaque types** — types whose representation is hidden, with identity preserved through nominal typing.

Documentation:
- **Documentation blocks** — `--- ... ---` blocks attached to subsequent declarations.

### Out of scope for v0.3 (deferred to v0.4+)

- Contexts as a declaration kind. (v0.4)
- Agents, services, capabilities. (v0.4-v0.5)
- The `consumes` keyword for context-to-context dependencies. (v0.4)
- Context-uses-commons mixin. (v0.4)
- Test contexts as a kind. (v0.5)
- User-defined generic types.
- Other built-in generics beyond `Result` and `Option` (no `List` yet).
- Extension methods (methods on types from outside the defining commons).
- Cross-reference validation in doc blocks (the `[name.path]` style references — collection only in v0.3; validation can come later).

The constraints from v0-v0.2 carry forward at the language level: commons-only, pure functions, no effects, no capabilities, no architecture.

---

## 2. Updated lexical structure

### New reserved keywords

```
opaque    uses
```

`opaque` is reserved for opaque type declarations. `uses` is reserved for commons-to-commons imports.

### New tokens

- **`---`** — three or more consecutive hyphens at the start of a line, opening or closing a documentation block.

### Documentation block lexing

A doc block is delimited by `---` markers. Content between markers is treated as freeform text (Markdown by convention; the lexer does not validate). The block must:

- Start with a line containing only `---` (and optional trailing whitespace).
- End with a line containing only `---`.
- Be at the top level (cannot appear inside expressions or types).

Content within the block is captured as a string and attached to the next non-doc-block declaration.

Single-line doc comments (`-- doc text` with a doc-style convention like `--! ` or similar) are *not* introduced in v0.3. Only the block form.

All other lexical rules are unchanged from v0.2.

---

## 3. Updated grammar

### 3.0 Qualified names — clarification

Throughout the grammar, `QualifiedName` is a dot-separated sequence of segments. Each segment must satisfy the identifier rules from v0 (§3.4): a letter followed by letters, digits, or underscores. Critically, **each segment must not be a reserved keyword**. Names like `commons.foo`, `if.something`, or `where.things` are syntactically invalid because at least one segment collides with a reserved word.

This rule applies to all qualified-name contexts: the name in a `commons` declaration header, the target of a `uses` clause, references in type and function declarations, and any other location where a qualified name appears. A negative test fixture exercising "unknown commons" must use a name composed entirely of valid identifier segments (e.g., `unknown.path.here`).

### 3.1 File-level structure

The grammar's top level changes to support multiple file forms:

```
karn-file       ::= commons-file
                  | commons-fragment-file

commons-file    ::= commons-brace-form

commons-brace-form ::= doc-block? 'commons' QualifiedName '{' commons-body '}'

commons-fragment-file ::= doc-block? 'commons' QualifiedName uses-decl* commons-body

commons-body    ::= commons-item*

commons-item    ::= doc-block? type-decl
                  | doc-block? fn-decl
                  | uses-decl
```

Two file forms:

**Brace form** (v0-v0.2 compatible):

```
commons commerce.money {
  type Money = { ... }
  fn Money.add(...) { ... }
}
```

**Fragment form** (new in v0.3):

```
commons commerce.money

uses commerce.identifiers

type Money = { ... }
fn Money.add(...) { ... }
```

The fragment form omits the braces. Top-level declarations follow the `commons` header. A single commons can be split across multiple fragment-form files in a directory.

A given file is one form or the other; the compiler determines from the token following the commons name. If `{`, brace form; otherwise fragment form.

### 3.2 Multi-file commons

A commons can be organised as multiple fragment-form files in a directory. The directory's path corresponds to the commons's qualified name:

```
src/commerce/money/         -- multi-file commons commerce.money
├── types.karn              -- contains `commons commerce.money` header + types
├── operations.karn         -- contains `commons commerce.money` header + functions
└── errors.karn             -- contains `commons commerce.money` header + error types
```

All files in the directory must declare the same commons name in their headers. The compiler combines them into one logical commons.

For brace-form (single-file) commons, the corresponding path is the file itself:

```
src/commerce/money.karn     -- single-file commons commerce.money
```

A given commons can be either a single file OR a directory — not both. The compiler errors if both `src/commerce/money.karn` and `src/commerce/money/` exist.

### 3.3 The `uses` declaration

```
uses-decl ::= 'uses' QualifiedName
```

A `uses` clause imports another commons's declarations by mixin. The clause must appear:

- In a brace-form commons, anywhere in the body (conventionally near the top).
- In a fragment-form commons, between the `commons` header and the body declarations.

Example:

```
commons commerce.money

uses commerce.identifiers

type Money = { ... }   -- can reference types from commerce.identifiers
```

A commons can have multiple `uses` clauses, each importing one commons.

**Resolution:**
- The target commons must exist in the project source tree.
- Cycles among commons are permitted (commons A uses commons B, commons B uses commons A is valid, because mixin is declarative — no runtime dependency).
- Name conflicts (two used commons define the same type or function) are detected at use site, with a clear diagnostic.

**Semantics (per the established mixin model):**
- All declarations from the target commons become available in the using commons's scope.
- Construction of mixed-in types is admitted in the using commons.
- Each using commons has its own nominal type derived from the mixed-in declaration (per the type identity rules in v0.2).

### 3.4 Opaque type declarations

```
type-decl ::= 'type' identifier '=' type-expr

type-expr ::= base-type ('where' refinement)?      -- refined value type (v0)
            | record-type                          -- record (v0.2)
            | sum-type                             -- sum (v0.2)
            | generic-type-ref                     -- Result, Option (v0.1, v0.2)
            | opaque-type                          -- NEW in v0.3

opaque-type ::= 'opaque' base-type ('where' refinement)?
```

An opaque type wraps a base type with hidden representation. From outside the type's defining commons, the base type is invisible — you cannot perform operations on the value as if it were the base type. The only operations available are:

- Construction via the implicit `.of(value)` static method (which validates refinement if present).
- Methods explicitly defined on the type.
- Equality and inequality comparison.
- Pattern matching with bindings (which still doesn't expose the base type value to outside code).

Example:

```
commons karn.time

type Timestamp = opaque Int

fn Timestamp.of(milliseconds: Int) -> Result[Timestamp, ValidationError] {
  if milliseconds < 0 {
    Err(InvalidTimestamp)
  } else {
    Ok(Timestamp.unsafe(milliseconds))     -- only available within the defining commons
  }
}

fn Timestamp.diff(self, other: Timestamp) -> Duration {
  Duration.unsafe(self.raw - other.raw)    -- .raw is internal field, not exported
}
```

Within the defining commons, an opaque type has access to its base value via the implicit `.raw` field (or equivalent — see §6 for compilation). Outside the commons, this field is not visible.

**Refined opaque types:** an opaque type can have a refinement on its base. The refinement is applied at the `.of()` constructor and is otherwise invisible.

**Construction:**
- `T.of(value)` is the public constructor. Returns `Result[T, ValidationError]` if there's a refinement, or `Result[T, ValidationError]` (effectively only Ok) if there isn't. (Consistent shape for tooling.)
- `T.unsafe(value)` is the unchecked constructor, *only available within the type's defining commons*. Bypasses refinement; used by methods that have already validated the value.

### 3.5 Documentation blocks

```
doc-block       ::= '---' newline doc-content '---' newline

doc-content     ::= (any line except a line consisting only of '---')*
```

A documentation block precedes a declaration and is attached to it. The content between markers is preserved verbatim (no preprocessing in v0.3).

**Whitespace handling.** A `---` marker line may have leading horizontal whitespace; the only requirement is that `---` is the sole non-whitespace token on the line. This matters in practice because doc blocks inside a brace-form commons are naturally indented to match the surrounding code:

```
commons commerce.money {
  ---
  The Money type represents an amount in a specific currency.
  ---
  type Money = { ... }
}
```

When doc content is indented, the compiler strips the common leading indent from every content line before storing the doc string. The stored content is the minimally-indented form of what the user wrote. This produces clean JSDoc in the emitted TypeScript regardless of source indentation.

Example:

```
---
The Money type represents an amount in a specific currency.

The minorUnits field is the smallest indivisible unit
of the currency (pence for GBP, cents for USD, etc.).
---
type Money = {
  minorUnits: Int where NonNegative,
  currency:   CurrencyCode,
}
```

Doc blocks can appear:
- Before any top-level declaration (`type`, `fn`).
- Before a commons declaration (the doc block describes the commons as a whole).
- Before fields within record types? — *No* in v0.3. Doc on fields is deferred. Only top-level declarations.

Multiple doc blocks cannot stack — only the immediately-preceding doc block is attached. A blank line between a doc block and a declaration loses the attachment (the doc becomes orphan, which is a warning).

### 3.6 Updated full file grammar

For reference:

```
karn-file       ::= commons-file
                  | commons-fragment-file

commons-file    ::= doc-block? 'commons' QualifiedName '{' commons-body '}'

commons-fragment-file ::= doc-block? 'commons' QualifiedName uses-decl* commons-body

commons-body    ::= commons-item*

commons-item    ::= doc-block? type-decl
                  | doc-block? fn-decl
                  | uses-decl

uses-decl       ::= 'uses' QualifiedName

type-decl       ::= 'type' identifier '=' type-expr

type-expr       ::= base-type ('where' refinement)?
                  | record-type
                  | sum-type
                  | generic-type-ref
                  | opaque-type

opaque-type     ::= 'opaque' base-type ('where' refinement)?

doc-block       ::= '---' newline doc-content '---' newline
```

All other productions are inherited from v0.2.

---

## 4. Updated static semantics

### 4.1 Multi-file commons resolution

When a directory contains multiple `.karn` files, all of which are fragment-form commons with the same name:

1. The compiler discovers all `.karn` files in the directory (non-recursive).
2. Each file is parsed independently.
3. Each file must have a matching `commons` header (all the same qualified name).
4. The declarations from all files are unioned into one logical commons.
5. Name conflicts between files (two `type Money = ...` declarations in different files) are compile errors.
6. The order of files is unspecified; declarations are unordered at the logical level, only at the file level.

For backwards compatibility, a single brace-form file is still valid; multi-file is opt-in via directory + fragment form.

### 4.2 The `uses` mechanism — commons importing commons

When a commons declares `uses other.commons`:

1. The target commons (`other.commons`) is resolved against the project source tree. Lookup is by qualified name → directory or file path.
2. If not found, compile error: "unknown commons `other.commons`."
3. All top-level declarations of the target commons are added to the current commons's scope.
4. Each declaration is treated as if locally declared (per the source-level mixin model).
5. Refined types' constructors (`Money.of`) are available.
6. Methods on types from the used commons are available on values of those types.

**Name conflicts:** If two used commons both declare a type or function with the same name, the use is ambiguous. The using commons must rename or restrict (renaming is a future feature; for v0.3, this is a compile error with a clear message).

**Cycles:** Permitted. `commerce.money uses commerce.identifiers` and `commerce.identifiers uses commerce.formatting` and `commerce.formatting uses commerce.money` is valid because mixin is declarative — no order-of-evaluation, no runtime dependency.

**Non-transitive imports.** The `uses` relationship is *not transitive*. If commons A uses commons B, and commons B uses commons C, then A does *not* see C's declarations through B. To use anything from C, A must explicitly declare `uses C` of its own. The reasoning is the standard modern-language rationale: transitive imports cause namespace pollution where a single `uses` clause can silently expose a large dependency graph, making it hard to reason about what's in scope. Non-transitive imports keep dependencies explicit at every site.

Self-referential imports (`commons A uses A`) are forbidden as a special case of cycles that serve no purpose.

A consequence worth being explicit about: if commons B's surface includes types that originated in commons C (e.g., B's function signatures use C's types), then a commons A that `uses B` will *see those types in B's signatures* but cannot reference them by name unless A also `uses C` directly. The signatures resolve correctly because B knows its dependencies; A's ability to write expressions referencing C's types separately requires its own import. Type aliasing within B (re-exporting a type from C under a local name) is not supported in v0.3.

### 4.3 Opaque type semantics

For `type T = opaque BaseType where ...`:

1. `T` is a nominal type distinct from `BaseType`.
2. Within the defining commons, the type has an implicit `.raw` field of type `BaseType` (for use by methods that need the underlying value).
3. Outside the defining commons:
   - The base type is not visible.
   - `.raw` is not accessible.
   - Construction is only via `T.of(value)` (which validates the refinement, if present).
   - All operations are via explicitly-defined methods on `T`.

4. Equality:
   - `==` and `!=` on opaque types compare by underlying value (the runtime representation), but this is hidden from the user — semantically, it's nominal equality on `T`.
   - Two `T` values are equal iff their underlying values are equal (which is structural equality on the base type).

5. The `T.of(value)` method:
   - For refined opaque types: applies the refinement, returns `Result[T, ValidationError]`.
   - For non-refined opaque types: still returns `Result[T, ValidationError]` for tooling consistency, always Ok (since no validation is needed).

6. The `T.unsafe(value)` method:
   - Available only in the defining commons.
   - Bypasses refinement.
   - Returns `T` directly (not a Result).
   - Used by methods that have already validated the value (or constructed it by some other means).

### 4.4 Documentation block attachment

A doc block is attached to the next non-doc declaration. If the doc block is followed by:

- A `type` or `fn` declaration: attached to that declaration.
- A `commons` declaration (at file start): attached to the commons.
- Another doc block: replaces (only the latest attaches).
- A blank line followed by a declaration: warning, doc orphan.

Doc content is preserved as a string in the AST. It is not parsed for content in v0.3 (no cross-reference checking, no Markdown rendering). The compiler simply attaches and preserves.

---

## 5. Updated type system

### 5.1 Opaque types as nominal types

Opaque types follow the standard nominal typing rules. Two opaque types declared in different commons (even with the same name and base) are distinct types. Two opaque types declared in the same commons but with different names are distinct types.

Opaque types do not widen to their base type. `let t: Timestamp = 5` is a compile error even though `Timestamp` has base `Int` — you must use `Timestamp.of(5)?` to construct.

### 5.2 Refined-but-not-opaque vs opaque

The two type forms differ in expressiveness:

- **Refined value type** (`type T = Int where ...`): nominal at type level, but allows operations on the base type when convenient (arithmetic on refined Ints, etc.). The refinement is enforced at construction.
- **Opaque type** (`type T = opaque Int where ...`): nominal, with no base-type operations available outside the defining commons. Refinement is enforced at construction. Methods must be explicitly defined.

Choosing between them:
- *Refined* when the value is conceptually a number/string with constraints, and arithmetic/string operations make sense.
- *Opaque* when the value is conceptually a distinct abstraction whose representation is incidental.

### 5.3 Imported types — same identity as the defining commons

When commons A `uses` commons B, and B declares `type Money = ...`, the Money type seen in commons A is *the same type* as the Money in commons B. (Distinct from the v0.2 commitment about contexts having their own nominal copies — that applies at the context boundary, not commons-to-commons.)

So values flow freely between commons that share a `uses` graph, without structural projection or constructor revalidation.

This distinction will become relevant in v0.4 when contexts use commons: a context using `commerce.money` will get its own nominal Money (per v0.2's type identity rule), while a commons using `commerce.money` shares the original Money type. The commons layer is monolithic at type identity level; contexts introduce the per-context nominal identity.

---

## 6. Updated compilation to TypeScript

### 6.1 Multi-file commons

A multi-file commons compiles to one TypeScript module per source file, all in the same output directory:

```
src/commerce/money/             →   out/commerce/money/
├── types.karn                  →   ├── types.ts
├── operations.karn             →   ├── operations.ts
└── errors.karn                 →   └── errors.ts
```

Each generated TypeScript file imports from siblings as needed. The compiler determines the dependencies and emits appropriate imports.

**Method placement across files.** A method declared in one file but attached to a type declared in a different file is emitted in the output file corresponding to the *type's* declaration site, not the method's. For example, if `timestamp.karn` declares `type Timestamp = opaque Int` and `operations.karn` declares `fn Timestamp.diff(self, ...)`, the `diff` method's TypeScript appears in `timestamp.ts` alongside the type's namespace block.

The rationale: keeping every method on `Timestamp` in one place (`timestamp.ts`'s `Timestamp` namespace) produces simpler TypeScript output that doesn't rely on namespace-merging across modules. The trade-off is that source-to-output correspondence is imperfect — `operations.karn` may compile to a TypeScript file containing only its file header, with all its methods having moved to their types' files. This is acceptable; readers of the generated TypeScript see methods grouped by type, which is the more useful organisation for navigation.

If a file authored as pure method definitions ends up with a nearly-empty corresponding TypeScript file, that is the expected outcome.

For the consumer (`commerce.orders` using the commons), the `uses commerce.money` clause translates to importing from the multi-file commons. Future versions may bundle to a single output file; for v0.3, one-to-one mapping.

### 6.2 The `uses` mechanism

A commons that `uses` another commons emits TypeScript imports for the types and functions it needs from the target commons. Imports are scoped to what's actually used (the compiler tree-shakes during emission).

```
commons commerce.money
uses commerce.identifiers

fn Money.attribute(self, customer: CustomerId) -> ... { ... }
```

Compiles to a TypeScript file that includes:

```typescript
import { CustomerId } from "../identifiers";

export namespace Money {
  export function attribute(self: Money, customer: CustomerId): /* ... */ { ... }
}
```

The compiler tracks which names are used from each `uses` import and emits a focused import statement. Unused imports do not appear in the output.

### 6.3 Opaque types

An opaque type compiles to a branded type with internal-only representation access:

```karn
type Timestamp = opaque Int

fn Timestamp.of(milliseconds: Int) -> Result[Timestamp, ValidationError] {
  if milliseconds < 0 {
    Err(ValidationError.invalid("Timestamp", "must be non-negative"))
  } else {
    Ok(Timestamp.unsafe(milliseconds))
  }
}
```

Compiles to:

```typescript
// Brand-only type alias (hides Int)
export type Timestamp = number & { readonly __brand: "Timestamp" };

export const Timestamp = {
  // Public constructor with validation
  of(milliseconds: number): Result<Timestamp, ValidationError> {
    if (milliseconds < 0) {
      return Err({ field: "Timestamp", message: "must be non-negative", value: milliseconds });
    }
    return Ok(milliseconds as Timestamp);
  },

  // Internal constructor — exported for commons-internal use only
  unsafe(value: number): Timestamp {
    return value as Timestamp;
  },
};
```

For methods within the defining commons that need `.raw` access:

```karn
fn Timestamp.diff(self, other: Timestamp) -> Duration {
  Duration.unsafe(self.raw - other.raw)
}
```

Compiles to:

```typescript
export namespace Timestamp {
  export function diff(self: Timestamp, other: Timestamp): Duration {
    return Duration.unsafe((self as number) - (other as number));
  }
}
```

The `self.raw` access compiles to `self as number` (or whichever base type) — a type assertion that's only valid within the defining commons. Outside the commons, this assertion path is not available; the type checker prevents `someTimestamp.raw` from compiling at the call site.

### 6.4 Documentation blocks

Doc blocks compile to JSDoc comments preceding the corresponding TypeScript declaration:

```karn
---
The Money type represents an amount in a specific currency.
---
type Money = { minorUnits: Int, currency: CurrencyCode }
```

Compiles to:

```typescript
/**
 * The Money type represents an amount in a specific currency.
 */
export interface Money {
  readonly minorUnits: number;
  readonly currency: CurrencyCode;
}
```

Doc on functions, methods, and the commons itself follow similar patterns. Doc on the commons is emitted at the top of each generated TypeScript file (for multi-file commons, on the entry file).

The compiler does no Markdown processing; the doc content is emitted verbatim within the JSDoc comment block.

---

## 7. New test corpus

The v0.3 test corpus adds fixtures for the new features. All v0/v0.1/v0.2 fixtures must continue to pass.

### Positive fixtures (new for v0.3)

```
tests/positive/
├── 50_doc_block_on_type/         -- doc block attached to a type declaration
├── 51_doc_block_on_fn/           -- doc block attached to a function
├── 52_doc_block_on_commons/      -- doc block on the commons itself
├── 53_doc_multiline/             -- multi-line doc content with formatting
├── 54_opaque_basic/              -- declare and use an opaque type
├── 55_opaque_with_refinement/    -- opaque with a where clause
├── 56_opaque_methods/            -- methods on opaque types using .raw
├── 57_fragment_form_commons/     -- single file with fragment-form syntax
├── 58_multi_file_commons/        -- multiple files contributing to one commons
├── 59_uses_single/               -- one commons uses another
├── 60_uses_multiple/             -- one commons uses several others
├── 61_uses_with_methods/         -- using commons can call methods on imported types
├── 62_uses_chain/                -- A uses B, B uses C — transitive resolution
├── 63_uses_cycle/                -- A uses B uses A — should compile
├── 64_full_time_commons/         -- worked example: karn.time with Timestamp and Duration
├── 65_money_uses_time/           -- commerce.money uses karn.time for transaction timestamps
```

### Negative fixtures (new for v0.3)

```
tests/negative/
├── 42_orphan_doc_block/             -- doc block with blank line before next decl (warning)
├── 43_unclosed_doc_block/           -- --- opens but never closes
├── 44_opaque_base_access_outside/   -- access .raw outside defining commons
├── 45_opaque_construct_direct/      -- attempt to construct opaque directly (must use .of)
├── 46_opaque_unsafe_outside/        -- attempt to call .unsafe outside defining commons
├── 47_uses_unknown_commons/         -- uses references a commons that doesn't exist
├── 48_uses_name_conflict/           -- two used commons declare the same type
├── 49_multi_file_inconsistent_name/ -- files in same dir have different commons names
├── 50_brace_and_dir/                -- both file.karn and file/ directory exist for same commons
├── 51_uses_in_brace_form/           -- uses clause in wrong position (if applicable)
```

### v0.3 worked example: karn.time + commerce.money

A worked example exercising opaque types, multi-file commons, and the uses mechanism:

**File structure:**

```
src/
├── karn/
│   └── time/                       -- multi-file commons karn.time
│       ├── timestamp.karn
│       ├── duration.karn
│       └── operations.karn
└── commerce/
    └── money.karn                  -- single-file commons commerce.money, uses karn.time
```

**`src/karn/time/timestamp.karn`:**

```
commons karn.time

---
A point in time, opaque integer milliseconds since Unix epoch.
---
type Timestamp = opaque Int where NonNegative

fn Timestamp.of(milliseconds: Int) -> Result[Timestamp, ValidationError] {
  Timestamp.of(milliseconds)   -- the implicit refinement-aware constructor
}

fn Timestamp.equals(self, other: Timestamp) -> Bool {
  self == other
}

fn Timestamp.before(self, other: Timestamp) -> Bool {
  self.raw < other.raw
}

fn Timestamp.after(self, other: Timestamp) -> Bool {
  self.raw > other.raw
}
```

**`src/karn/time/duration.karn`:**

```
commons karn.time

---
A length of time in milliseconds. Can be negative (representing past intervals).
---
type Duration = opaque Int

fn Duration.of(milliseconds: Int) -> Result[Duration, ValidationError] {
  Ok(Duration.unsafe(milliseconds))
}

fn Duration.zero() -> Duration {
  Duration.unsafe(0)
}

fn Duration.isPositive(self) -> Bool {
  self.raw > 0
}

fn Duration.isZero(self) -> Bool {
  self.raw == 0
}
```

**`src/karn/time/operations.karn`:**

```
commons karn.time

---
Compute the duration between two timestamps. Returns positive when 
the second timestamp is after the first.
---
fn Timestamp.diff(self, later: Timestamp) -> Duration {
  Duration.unsafe(later.raw - self.raw)
}

---
Add a duration to a timestamp, producing a new timestamp.
Returns None if the result would be negative (before epoch).
---
fn Timestamp.add(self, delta: Duration) -> Option[Timestamp] {
  let result = self.raw + delta.raw
  if result < 0 {
    None
  } else {
    Some(Timestamp.unsafe(result))
  }
}
```

**`src/commerce/money.karn`:**

```
---
Money commons. Represents currency amounts as minor units (pence, cents)
paired with currency codes. Supports basic arithmetic with currency-mismatch detection.
---
commons commerce.money

uses karn.time

type CurrencyCode = String where Matches("[A-Z]{3}")

---
A monetary amount paired with its currency.
---
type Money = {
  minorUnits: Int where NonNegative,
  currency:   CurrencyCode,
}

type MoneyError = enum {
  CurrencyMismatch,
  InsufficientFunds,
}

---
A transaction record pairing money movement with its timestamp.
The timestamp uses karn.time's opaque Timestamp type, ensuring temporal
operations are explicit.
---
type Transaction = {
  amount:    Money,
  occurred:  Timestamp,
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

fn Transaction.of(amount: Money, occurred: Timestamp) -> Transaction {
  Transaction { amount, occurred }
}

fn Transaction.duration(self, other: Transaction) -> Duration {
  self.occurred.diff(other.occurred)
}
```

This worked example exercises:
- Opaque types with refinement (`Timestamp`)
- Opaque types without refinement (`Duration`)
- The `.raw` field for internal use by methods
- The `.unsafe` constructor for internal use
- Multi-file commons (karn.time has three files)
- Commons using another commons (commerce.money uses karn.time)
- Doc blocks on commons, types, and functions
- Type identity across commons (Timestamp in commerce.money is karn.time's Timestamp)

---

## 8. Implementation notes

### 8.1 Backwards compatibility

All v0/v0.1/v0.2 fixtures must pass. The brace-form commons syntax remains valid. The fragment-form is new and parallel.

### 8.2 Where new code goes

- `lexer.rs`: new keywords (`opaque`, `uses`); new token (`---` doc block marker); doc block content tokenisation.
- `ast.rs`: 
  - `TypeExpr::Opaque(BaseType, Option<Refinement>)` variant.
  - `CommonsDecl::Fragment` (headerless) variant alongside the existing brace form.
  - `UsesDecl` AST node.
  - `Documentation` attached as Option<String> on decl nodes.
- `parser.rs`: 
  - Fragment-form commons parsing.
  - Doc block parsing and attachment to subsequent declarations.
  - Opaque type expressions.
  - `uses` declarations.
- `resolver.rs`: 
  - Multi-file directory discovery and commons assembly.
  - `uses` resolution against the project source tree.
  - Cycle handling (declarative — cycles permitted, no order issues).
  - Opaque type registration with both `.of()` and `.unsafe()` methods.
  - `.raw` field visibility (defining-commons-only).
- `checker.rs`: 
  - Opaque-type construction restrictions.
  - `.raw` access scoping.
  - Method dispatch across `uses` imports.
- `emitter.rs`: 
  - JSDoc emission for doc blocks.
  - Opaque type lowering (brand + private representation access).
  - TypeScript imports for `uses` dependencies.
  - Multi-file commons → multi-file TypeScript output.

### 8.3 Risk areas

- **Multi-file commons discovery.** The build system needs to walk directories and collect all `.karn` files. The compiler needs to handle this without confusion. Make sure the rule is clear: a `.karn` file at `src/X/Y.karn` is single-file commons `X.Y`; a directory at `src/X/Y/` with `.karn` files is multi-file commons `X.Y`. Both cannot exist.

- **Cycle handling in `uses`.** Cycles are permitted, but the compiler must not loop forever during resolution. Implement using a two-pass approach: first pass collects all declarations from all commons; second pass type-checks with the full symbol table available.

- **Doc block attachment.** Blank lines, comments, and other "between" content must not break attachment, but a blank line specifically should orphan the doc with a warning. Decide on the precise rule for what counts as "attached" vs "orphan."

- **Opaque type .raw access.** The compiler must know which commons each declaration belongs to, and reject `.raw` access from outside that commons. This requires per-commons declaration context to flow through the type checker.

- **Refined opaque type constructors.** The `Timestamp.of(...)` for `type Timestamp = opaque Int where NonNegative` should look exactly like a refined-Int's `of` from v0 — same signature, same Result return. The difference is hidden in the type's internals.

### 8.4 What "done" looks like

1. All v0, v0.1, v0.2 fixtures pass (regression).
2. All v0.3 fixtures pass (16 positive, 10 negative).
3. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` are clean.
4. The karn.time + commerce.money worked example compiles, with TypeScript output that `tsc --noEmit --strict` accepts.
5. Multi-file commons produces correct output structure with proper imports between generated TypeScript files.
6. Doc blocks appear as JSDoc in the output.

---

## 9. v0.4 preview (for context)

What's coming after v0.3:

The architectural layer begins. v0.4 introduces:

1. **Contexts as a declaration kind** — `context commerce.orders { ... }`. Distinct from commons; carries different rules (encapsulation, exports, etc.).
2. **Context-uses-commons** — applying the `uses` mechanism to bring commons into contexts, with per-context nominal type identity.
3. **Context exports** — `exports opaque { ... }` and `exports transparent { ... }` clauses for governing what callers can see.
4. **Context-to-context `consumes`** — declaring behavioural dependencies on other contexts (without yet having services to consume).

v0.5 onward will add the truly architectural elements: agents, services, handlers, capabilities, the `given` clause, effects, and test contexts.

After v0.4, the language has both a commons layer (vocabulary) and a context layer (architectural units). This is when Karn starts being a recognisable bounded-context language rather than a typed-pure-function language.
