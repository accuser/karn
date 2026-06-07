# Karn v0.4 Grammar — Contexts (the architectural layer begins)

A delta specification introducing contexts as a declaration kind alongside commons. Read the earlier grammar specs first — **`karn-mvp-grammar.md`** (v0), **`karn-mvp-grammar-v0.1.md`**, **`karn-mvp-grammar-v0.2.md`**, **`karn-mvp-grammar-v0.3.md`**. This document specifies only what changes from v0.3.

The v0.4 compiler should accept every earlier program unchanged. All v0–v0.3 test fixtures must continue to pass. v0.4 adds new productions; it does not alter the meaning of existing constructs.

This is the largest *conceptual* step in the language so far. Up to v0.3, Karn was a typed pure-function language with a commons-based vocabulary system — useful for libraries but not yet architectural. v0.4 introduces *contexts*: the bounded-context construct that wraps state, behaviour, and boundary contracts. After v0.4 the language has both layers (commons for vocabulary, contexts for architecture), though contexts in v0.4 are still hollow — agents, services, capabilities, and effects come in v0.5+.

---

## 1. Scope

### In scope for v0.4

Architectural layer:
- **Contexts as a declaration kind** — `context commerce.orders { ... }` alongside `commons` and `test`.
- **Context body items** — types (the same shape as commons types) and pure functions; agents, services, and capabilities are deferred.
- **Context exports** with visibility — `exports opaque { ... }` and `exports transparent { ... }` clauses.
- **Context-uses-commons** — the `uses` mechanism extended to contexts, with per-context nominal type identity per v0.2's commitment.
- **Context-to-context `consumes`** — declaring behavioural dependency on another context (the graph; not yet the call sites).
- **Type identity machinery** — each context that `uses` a commons gets its own nominal type derived from each mixed-in commons declaration.

### Out of scope for v0.4 (deferred to v0.5+)

- Agents within contexts (`agent` declarations).
- Services within contexts (`service` declarations, handler shapes).
- Capabilities and providers.
- The `given` clause and effects.
- Cross-context service calls (the call syntax that uses `consumes` declarations).
- Test contexts as a kind (`test` targeting contexts; only commons-test exists in v0.4).
- Storage and state.
- Wire serialisation and the runtime cross-context invocation infrastructure.
- Extension methods on commons types from inside a context.

The constraints that carry forward: pure functions only, no effects. Contexts in v0.4 are still pure — they have richer organisational structure (exports, consumed dependencies) but no behavioural surface.

---

## 2. Updated lexical structure

### New reserved keywords

```
context     consumes    exports     transparent
```

`context` introduces a context declaration. `consumes` declares a behavioural dependency on another context. `exports` opens an export clause. `transparent` (already informally used in the design notes) becomes a reserved keyword as one of the two export visibility kinds. (`opaque` was reserved in v0.3.)

All other lexical rules are unchanged from v0.3.

---

## 3. Updated grammar

### 3.1 File-level structure

The grammar's top level gains a second declaration kind:

```
karn-file       ::= commons-file                  -- as in v0.3
                  | commons-fragment-file         -- as in v0.3
                  | context-file
                  | context-fragment-file
```

Contexts mirror commons in supporting both brace and fragment forms:

```
context-file             ::= doc-block? 'context' QualifiedName '{' context-body '}'

context-fragment-file    ::= doc-block? 'context' QualifiedName uses-decl* consumes-decl* exports-decl* context-body

context-body             ::= context-item*

context-item             ::= doc-block? type-decl
                           | doc-block? fn-decl
                           | uses-decl
                           | consumes-decl
                           | exports-decl
```

The brace form:

```
context commerce.orders {
  uses commerce.money
  consumes commerce.payment
  
  exports opaque      { OrderId }
  exports transparent { OrderError, Order }
  
  type OrderId    = opaque String where Matches("ORD-[0-9]{6}")
  type OrderError = enum { CartEmpty, PaymentFailed, OutOfStock }
  type Order      = { ... }
  
  fn ...
}
```

The fragment form (for multi-file contexts):

```
context commerce.orders

uses commerce.money
consumes commerce.payment

exports opaque      { OrderId }
exports transparent { OrderError, Order }

type OrderId    = ...
```

Multi-file contexts work the same way as multi-file commons: a directory whose name matches the context's qualified name, containing multiple fragment-form `.karn` files all carrying the same `context` header.

### 3.2 The `consumes` declaration

```
consumes-decl ::= 'consumes' QualifiedName
```

A `consumes` clause declares a behavioural dependency on another context. Semantics in v0.4 are limited because there are no services to call yet:

1. The target context must exist in the project.
2. The dependency is recorded in the project graph.
3. Type visibility from the consumed context is governed by that context's exports (see §3.3).

`consumes` is distinct from `uses`:
- `uses` (commons mixin) brings declarations into local scope, with construction admitted locally.
- `consumes` (context dependency) does *not* mix in declarations. It declares architectural dependency. Types from the consumed context are visible only through their exports, and construction stays in the owning context.

A context may have any number of `consumes` clauses. Cycles between contexts via `consumes` should not be permitted in v0.4 — context graphs are expected to be acyclic. (Cycles among commons are fine because commons are declarative; cycles among contexts would imply mutual behavioural dependence, which is an architectural antipattern. v0.4 enforces this with a compile error.)

### 3.3 The `exports` declaration

```
exports-decl     ::= 'exports' visibility '{' export-list '}'

visibility       ::= 'opaque' | 'transparent'

export-list      ::= identifier (',' identifier)* ','?
```

An `exports` clause declares which types are visible to consumers of this context, and how. A context may have multiple `exports` clauses (one per visibility, conventionally). Each clause lists type names declared in the same context.

```
exports opaque      { OrderId, CartItemId }
exports transparent { OrderError, Order, OrderStatus }
```

**Visibility semantics:**

- **`exports opaque { T }`**: Outside the context, `T` is a *token* — consumers can hold values, store them, pass them as arguments, compare for equality. They cannot inspect (no field access, no pattern matching) and cannot construct.

- **`exports transparent { T }`**: Outside the context, `T` is *readable data* — consumers can read fields (for records), match on variants (for sums), inspect refinements (for refined values). They still cannot construct new values.

- *Not in any exports clause*: the type is private to the context. Other contexts cannot reference it by name. Storage layouts, helper types, anything internal goes here.

A type appearing in *both* an opaque and a transparent exports clause is an error — pick one visibility.

**Refinement and exports.** A refined type's refinement is part of its public surface for transparent exports but hidden for opaque exports. So `exports transparent { Sku }` (where `Sku = String where Matches("[A-Z0-9]{3,16}")`) lets consumers know the validation rule and pattern; `exports opaque { Sku }` hides it.

**Cross-reference with v0.3 opaque types.** A context can have `type T = opaque BaseType` (the v0.3 opaque type form) *and* export it transparently or opaquely. These are orthogonal:

- The v0.3 `opaque` keyword controls *representation hiding within the type's scope* — whether `.raw` is accessible, whether the base type is visible in operations.
- The v0.4 `exports opaque` controls *visibility to consumers outside the context* — whether they can construct, read, or only hold.

Most commonly, opaque types are exported opaquely (the natural pairing). But a context could declare `type OrderError = enum { ... }` (transparent at the type-system level) and export it transparently (consumers can match on variants). The two layers compose.

### 3.4 Type identity for context-uses-commons

When a context declares `uses commerce.money`, the commons's declarations are mixed in per the established source-level mixin model (§2.1.4 of the type system spec). The crucial v0.4 commitment: **each context that uses a commons gets its own nominal type identity for the mixed-in declarations**.

Concretely:
- If `commerce.orders uses commerce.money` and `commerce.payment uses commerce.money`, the type `Money` in `commerce.orders` is *distinct* (nominally) from the type `Money` in `commerce.payment`, even though both derive from the same `commerce.money.Money` declaration.
- Within `commerce.orders`, all references to `Money` mean `commerce.orders.Money`.
- Within `commerce.payment`, all references to `Money` mean `commerce.payment.Money`.
- The two types are *structurally identical* (because they derive from the same declaration source) but *nominally distinct*.

This is a marked difference from v0.3's commons-to-commons `uses`, where a `Money` imported into another commons retains the original `commerce.money.Money` identity. The change reflects the architectural reality: commons is a flat vocabulary layer with shared nominal identity; contexts are bounded units of meaning with per-unit identity.

**Cross-context value flow.** Because two contexts have distinct nominal types for a "shared" commons type, values do not flow nominally between them. Cross-context flow goes through *structural projection*:

- The sending context serialises its value to a wire format (the structural shape).
- The receiving context constructs its own nominal type from that data, applying its local refinements.

In v0.4, cross-context flow doesn't actually exist yet (no service call mechanism). The type identity rule is set up so that v0.5+ (with services) can implement structural projection correctly. For v0.4, the rule is enforced statically — code that tries to pass a `commerce.orders.Money` where a `commerce.payment.Money` is expected is a compile error.

### 3.5 Combined commons + context source tree

A project mixes commons and contexts at the top level. Directories and files distinguish by declaration kind:

```
src/
├── commerce/
│   ├── money/                  -- commons commerce.money (multi-file)
│   │   ├── types.karn
│   │   └── operations.karn
│   ├── identifiers.karn        -- commons commerce.identifiers
│   ├── orders/                 -- context commerce.orders (multi-file)
│   │   ├── types.karn
│   │   └── helpers.karn
│   └── payment.karn            -- context commerce.payment
└── karn/
    └── time/                   -- commons karn.time (multi-file)
        └── ...
```

The compiler's project module determines kind by reading each file's declaration header (`commons` vs `context`). All files in one directory must agree on kind and name. A directory with one `context` file and one `commons` file is a compile error.

### 3.6 Updated full file grammar

```
karn-file       ::= commons-file
                  | commons-fragment-file
                  | context-file
                  | context-fragment-file

context-file             ::= doc-block? 'context' QualifiedName '{' context-body '}'

context-fragment-file    ::= doc-block? 'context' QualifiedName 
                              context-header-decl* 
                              context-body

context-header-decl      ::= uses-decl
                           | consumes-decl
                           | exports-decl

context-body             ::= context-item*

context-item             ::= doc-block? type-decl
                           | doc-block? fn-decl
                           | uses-decl
                           | consumes-decl
                           | exports-decl

consumes-decl   ::= 'consumes' QualifiedName

exports-decl    ::= 'exports' visibility '{' export-list '}'

visibility      ::= 'opaque' | 'transparent'

export-list     ::= identifier (',' identifier)* ','?
```

All other productions are inherited from v0.3.

---

## 4. Updated static semantics

### 4.1 Project resolution with contexts

The project's two-pass resolution (from v0.3) extends to handle contexts:

**Pass 1 — declaration collection:**

1. Walk the source tree, parsing every `.karn` file.
2. For each file, determine kind (commons vs context) from the header.
3. Group files by qualified name. All files in one group must agree on kind.
4. Build a symbol table per commons and per context.
5. Record `uses` and `consumes` clauses.
6. Resolve cross-references for `uses` (target must exist) and `consumes` (target must exist).

**Pass 2 — type-check each unit with full information:**

1. For each commons, type-check using its local declarations plus mixed-in declarations from `uses` (commons-to-commons mixin preserves type identity).
2. For each context, type-check using its local declarations plus *re-branded* mixed-in declarations from `uses` (commons-to-context mixin produces per-context nominal types). Visible types from `consumes` clauses are determined by the consumed context's exports.

### 4.2 Type identity rebranding

This is new in v0.4 and the most subtle part of the implementation.

When `commerce.orders uses commerce.money`:

1. Every type declared in `commerce.money` produces a new nominal type in `commerce.orders`'s scope: `commerce.orders.Money` (distinct from `commerce.money.Money`).
2. Every method on a `commerce.money` type produces a corresponding method on the rebranded type. `Money.add(self, other)` in commerce.money becomes a method available on `commerce.orders.Money` with signature `commerce.orders.Money.add(self: commerce.orders.Money, other: commerce.orders.Money) -> Result[commerce.orders.Money, MoneyError]`.
3. References to `Money` inside `commerce.orders` resolve to `commerce.orders.Money`.
4. Constructor functions like `Money.of(...)` produce `Result[commerce.orders.Money, ValidationError]` when called inside `commerce.orders`.

This rebranding happens during symbol-table construction for each context. Each context has its own copy of every type from every commons it uses, distinct from copies in other contexts.

**Implementation note.** This is essentially a substitution at the type-identity level. The compiler can implement this by:
- Maintaining a per-context type table that maps each used commons declaration to a freshly-minted nominal type.
- When resolving names in the context, looking up types in the local + rebranded-imported table.
- When emitting TypeScript, the rebranded type uses a distinct brand value (e.g., `__brand: "commerce.orders.Money"` vs `__brand: "commerce.payment.Money"`).

### 4.3 The `consumes` mechanism

When `commerce.orders consumes commerce.payment`:

1. `commerce.payment` must exist as a context (not a commons).
2. Types exported by `commerce.payment` are visible in `commerce.orders` *according to their export visibility*:
   - Opaquely-exported types: visible as nominal types; can be held, compared, passed; cannot be constructed or inspected.
   - Transparently-exported types: visible as nominal types with readable shape; fields accessible (records); variants matchable (sums); refinements visible. Cannot be constructed.
   - Private (unexported) types: not visible at all. Even mentioning the name is a compile error.
3. The visible types retain their nominal identity from the consumed context — `commerce.orders` sees `commerce.payment.AuthId`, not its own rebranded copy.
4. v0.4 does not yet have a way to *call* into the consumed context. The dependency is declared, the type surface is exposed, but no call syntax exists.

**Why nominal identity is preserved across `consumes` (but not across `uses`).** The contrast with mixin is deliberate. Commons-via-mixin reflects "shared vocabulary": each using context has its own copy with the same shape, because that's the architectural meaning of vocabulary sharing. Context-via-consumes reflects "behavioural dependency": the consumed context owns its types; consumers see them through their exports without minting copies. The mechanisms answer different architectural questions and have different identity semantics.

### 4.4 Export validation

Each `exports` clause's name list:

1. Every name must be a type declared in the same context (not a method, not a function, not an imported type).
2. Every name must be declared (not just referenced — declared in this context).
3. No duplicate names across exports clauses (a type can't be in both opaque and transparent).
4. No duplicate names within a single exports clause.

Types not appearing in any exports clause are private. They cannot be referenced from outside the context.

### 4.5 Cycle detection for contexts

For `consumes` cycles:
- A graph of `consumes` edges is built across all contexts.
- A cycle (A consumes B consumes A, or longer chains) is a compile error.
- The error message lists the cycle's contexts.

`uses` does not participate in cycle detection at the context level — commons-uses-commons cycles are permitted (per v0.3), and commons-context (one-direction) doesn't form a cycle.

---

## 5. Updated type system

### 5.1 Per-context nominal types from mixin

As described in §4.2, each context's `uses commerce.money` produces fresh nominal types per the source-level-mixin compilation model. Two contexts that both use the same commons have structurally compatible but nominally distinct types.

This is the type-system landing of the v0.2 commitment about cross-context type identity. It only takes effect in v0.4 because v0.3 had no contexts to apply it to.

### 5.2 Cross-context type identity through `consumes`

Types visible through `consumes` retain the consumed context's nominal identity. A `commerce.payment.AuthId` referenced in `commerce.orders` is the same `commerce.payment.AuthId`, not a rebranded copy. This is consistent with the architectural intent: the consumed context owns its types; consumers refer to them.

### 5.3 Construction rule (now in force)

The encapsulation principle from §2.1.3 of the type system spec is now meaningfully enforced. A value of a context-owned type can only be constructed within that context. Outside the context:
- Direct record construction (`Order { ... }`) is rejected by the type checker.
- Calling a constructor function (`Order.of(...)`) is rejected unless the function is explicitly exported (which would be a static method on the type, not a value of it). In practice, this means a context owns its types and constructors entirely.
- The only way for an external context to obtain a value of a type owned by `commerce.orders` is to receive it through a service call return value — which doesn't exist in v0.4. So in v0.4, externally-owned types are essentially opaque from outside, with construction strictly forbidden.

For commons types (mixed in via `uses`), construction is admitted locally because the using context is a defining context for the mixed-in copies. This matches the mixin model's intent — shared vocabulary is constructible everywhere it's shared into.

---

## 6. Updated compilation to TypeScript

### 6.1 Contexts compile per-file like commons

A context's compilation follows the same per-file mapping as commons. A multi-file context produces multiple TypeScript files in a corresponding output directory.

```
src/commerce/orders/             →   out/commerce/orders/
├── types.karn                  →   ├── types.ts
└── helpers.karn                →   └── helpers.ts
```

The same rules apply:
- Each `.karn` file produces a corresponding `.ts` file.
- Methods declared in one file but attached to a type declared in another are emitted alongside their type's namespace block (§6.1 of v0.3 spec).
- Imports between sibling files in the same context use relative paths.
- Imports from used commons reference the commons's output.
- Imports from consumed contexts reference the consumed context's output, filtered to only exported types.

### 6.2 Rebranding mixed-in types

A context that `uses commerce.money` and references `Money` in its declarations emits TypeScript with a fresh brand for its local `Money`:

```karn
context commerce.orders
uses commerce.money

type Order = {
  total: Money,
}
```

Compiles to (in `commerce.orders`):

```typescript
import { Money as CommonsMoney } from "../money";

// The context's nominal Money is distinct from the commons's
export type Money = CommonsMoney & { readonly __ctxBrand: "commerce.orders" };

export const Money = {
  of(minorUnits: number, currency: string): Result<Money, MoneyError> {
    const commons = CommonsMoney.of(minorUnits, currency);
    if (!commons.ok) return commons;
    return Ok(commons.value as Money);
  },
  // ... rebranded versions of all the commons methods
};

export interface Order {
  readonly total: Money;
}
```

The rebranding compiles via the intersection type pattern. The context's `Money` is the commons's `Money` plus an additional brand specific to the context. This makes the rebranded type usable wherever the commons's `Money` is expected (structurally compatible) but the additional brand prevents accidentally treating one context's Money as another's at the TypeScript level.

Methods on rebranded types are emitted in the context's TypeScript, taking the rebranded type as receiver. This is verbose at emission time but produces correct nominal-distinction in TypeScript's type checker.

### 6.3 Exports

Visibility levels compile to different TypeScript visibility patterns:

**Opaque export.** The type is exported but its structure is hidden. The compiler can achieve this in TypeScript by:
- Exporting only the brand-typed alias (`export type AuthId = number & { readonly __brand: "AuthId" }`).
- Not exporting the constructor namespace from this module to external consumers (or exporting it through an internal-only re-export path).

In practice, the simplest implementation: emit the type alias as an export, omit the constructor namespace from the public re-export. External code can hold values of the type but cannot construct or inspect them.

**Transparent export.** The type is exported with full readable shape. Records expose their interface; sums expose their discriminated-union type with all variants visible. Construction is still prevented because the constructor namespace's `.of(...)` and `unsafe` methods are not exported (only the type alias and any read-side helpers).

### 6.4 `consumes` compiles to imports

A `consumes` clause translates to TypeScript imports from the consumed context's output, filtered to the consumed context's exports. The using context can import only what was exported.

```karn
context commerce.orders
consumes commerce.payment

-- references commerce.payment.PaymentError in some signature
```

Compiles to:

```typescript
import { PaymentError } from "../payment";   // PaymentError is in commerce.payment's exports
```

If the using context tries to reference a private (unexported) type from the consumed context, the type checker rejects it before emission.

### 6.5 No runtime cross-context call infrastructure yet

v0.4's compiled output contains no runtime mechanism for cross-context calls — that needs services and capabilities (v0.5+). The compiled TypeScript for a context is a TypeScript module containing types and pure functions; consumers can `import` it but there's no concept of a service operation, a handler, or invocation. This is intentional — v0.4 sets up the type-system and visibility infrastructure; v0.5 adds the runtime layer on top.

---

## 7. New test corpus

The v0.4 test corpus adds context-focused fixtures.

### Positive fixtures (new for v0.4)

```
tests/positive/
├── 66_minimal_context/                  -- empty context with no body
├── 67_context_with_types/               -- context declaring types but no exports
├── 68_context_exports_opaque/           -- single opaque export
├── 69_context_exports_transparent/      -- single transparent export
├── 70_context_mixed_exports/            -- both opaque and transparent
├── 71_context_uses_commons/             -- context mixing in a commons
├── 72_context_uses_multiple_commons/    -- multiple uses clauses
├── 73_context_consumes_context/         -- context declaring consumes
├── 74_context_uses_and_consumes/        -- both clauses in one context
├── 75_fragment_form_context/            -- fragment-form context file
├── 76_multi_file_context/               -- context across multiple files
├── 77_two_contexts_same_commons/        -- two contexts use same commons, distinct nominal types
├── 78_orders_payment_skeleton/          -- commerce.orders consumes commerce.payment with shared commons
├── 79_full_layered_project/             -- worked example: commons + multiple contexts
```

### Negative fixtures (new for v0.4)

```
tests/negative/
├── 52_consumes_unknown_context/         -- consumes references nonexistent context
├── 53_consumes_a_commons/               -- consumes a commons (must be context)
├── 54_uses_a_context/                   -- uses a context (must be commons)
├── 55_context_cycle/                    -- A consumes B consumes A
├── 56_export_undeclared_type/           -- exports lists a name that isn't declared
├── 57_export_in_both_visibilities/      -- T in both opaque and transparent
├── 58_external_construction/            -- attempt to construct context-owned type from outside
├── 59_unexported_type_access/           -- reference a private type from another context
├── 60_cross_context_money_mismatch/     -- pass commerce.orders.Money where commerce.payment.Money expected
├── 61_context_directory_mixed_kinds/    -- directory with both commons and context files
```

### v0.4 worked example: layered project

The worked example for v0.4 demonstrates the full architectural layering with commons and contexts coexisting:

**File structure:**

```
src/
├── commerce/
│   ├── money.karn                  -- commons commerce.money (from v0.2 work)
│   ├── identifiers.karn            -- commons commerce.identifiers with id types
│   ├── orders.karn                 -- context commerce.orders
│   └── payment.karn                -- context commerce.payment
└── karn/
    └── time/                       -- commons karn.time (from v0.3 work)
        └── ...
```

**`src/commerce/identifiers.karn`:**

```
commons commerce.identifiers

type OrderId    = String where Matches("ORD-[0-9]{6}")
type AuthId     = String where Matches("AUTH-[0-9]{8}")
type CustomerId = String where Matches("CUST-[0-9]+")
```

**`src/commerce/payment.karn`:**

```
---
Payment context. Authorises monetary transactions and records auth IDs.
---
context commerce.payment

uses commerce.money
uses commerce.identifiers

exports opaque      { AuthId }
exports transparent { PaymentError }

type PaymentError = enum {
  Declined,
  InsufficientFunds,
  GatewayDown,
}

---
A payment authorisation. Internal record paired with the public AuthId.
---
type Authorisation = {
  id:        AuthId,
  amount:    Money,
  customer:  CustomerId,
}
```

(No services yet — just type structure. v0.5 will add `service authorise(amount: Money) -> Result[AuthId, PaymentError]`.)

**`src/commerce/orders.karn`:**

```
---
Orders context. Composes cart items, applies discounts, places orders.
Depends on commerce.payment for authorisation (v0.5+).
---
context commerce.orders

uses commerce.money
uses commerce.identifiers
uses karn.time
consumes commerce.payment

exports opaque      { Order, CartItem }
exports transparent { OrderError, OrderStatus }

type OrderError = enum {
  EmptyCart,
  TooManyItems,
  TotalExceedsLimit,
}

type OrderStatus =
  | Pending
  | Placed(at: Timestamp)
  | Cancelled(reason: String)

---
A single line item in a cart. Combines a quantity with a unit price.
---
type CartItem = {
  productId: CustomerId,       -- placeholder; real domain has ProductId
  quantity:  Int where InRange(1, 99),
  unitPrice: Money,
}

---
An order record. Carries items, status, customer, and timestamps.
---
type Order = {
  id:       OrderId,
  customer: CustomerId,
  items:    Int,               -- placeholder for List[CartItem] (v0.5+)
  total:    Money,
  status:   OrderStatus,
  placedAt: Timestamp,
}

fn computeSimpleTotal(itemCount: Int, unitPrice: Money) -> Money {
  unitPrice.multiplyBy(itemCount)
}
```

This worked example exercises:
- Multiple commons used together (`commerce.money`, `commerce.identifiers`, `karn.time`).
- One context consuming another (`commerce.orders consumes commerce.payment`).
- Both visibility levels in `exports` (opaque for Order/CartItem, transparent for OrderError/OrderStatus).
- Per-context nominal type identity (commerce.orders.Money is distinct from commerce.payment.Money even though both use commerce.money).
- Doc blocks at context, type, and field-comment level.

The TypeScript output should compile cleanly under `tsc --noEmit --strict`. Two different `Money` types appear at the TypeScript level (with distinct brands), demonstrating the nominal distinction.

---

## 8. Implementation notes

### 8.1 Backwards compatibility

All v0–v0.3 fixtures must pass. The grammar additions are additive — no existing production is altered. Existing commons files compile unchanged.

The project module's directory walking needs to be extended to recognise context files, but the core machinery (per-file parsing, header detection, kind grouping) is the same.

### 8.2 Where new code goes

In the existing implementation structure:

- `lexer.rs`: new keywords (`context`, `consumes`, `exports`, `transparent`).
- `ast.rs`:
  - `ContextDecl` parallel to `CommonsDecl`.
  - `ConsumesDecl` and `ExportsDecl` AST nodes.
  - Top-level `Declaration` enum gains a `Context(ContextDecl)` variant.
- `parser.rs`:
  - Context declarations (brace and fragment forms).
  - `consumes` and `exports` clauses.
- `project.rs` (the module from v0.3):
  - Recognises context kind in headers.
  - Groups context files by qualified name.
  - Builds context symbol tables alongside commons tables.
  - Records the `consumes` dependency graph.
  - Performs cycle detection on contexts.
- `resolver.rs`:
  - For each context, builds a rebranded symbol table for `uses` imports (the new type identity machinery).
  - For each context, looks up consumed context's exports for `consumes` imports.
  - Rejects references to private (unexported) types from consumed contexts.
- `checker.rs`:
  - Validates exports clauses (every name is a local type, no duplicates).
  - Enforces construction rule for context-owned types.
  - Type-checks expressions involving rebranded types (nominal distinction).
- `emitter.rs`:
  - Emits context output (similar to commons, with rebranded type emissions).
  - Generates intersection-type rebranding for mixed-in types.
  - Generates filtered exports (only exported types are re-exported).

### 8.3 Risk areas

This is the largest set of v0.4 risks. Several are new:

**Type identity rebranding.** This is genuinely new type-system machinery. Each context's symbol table contains "rebranded" copies of every type from every commons it uses. The challenge:
- Methods on the original type need rebranded equivalents that operate on the rebranded type.
- Refinement-aware constructors (`.of`) need to produce the rebranded type, not the original.
- TypeScript emission needs to express the nominal distinction via brands.

Plan to invest real time here. The cleanest implementation is to materialise the rebranded type table during pass 2 of resolution, with each context's "view" of imported types stored separately.

**Export validation across declaration sites.** A context's `exports` clauses can appear in any of its source files. The validator must collect all of them, validate that exported names are declared locally, and check for cross-clause conflicts. This is similar to how multi-file commons handles declarations but applied to exports.

**Construction enforcement at type-check time.** The construction rule says only the defining context can construct. The type checker needs to know "which context is currently in scope" and reject record construction or `T.of(...)` calls on types from other contexts. The check is at the use site, not the declaration site.

**Per-context emission with brand differentiation.** The emitter needs distinct brand strings per context for the same imported commons type. Generating `__ctxBrand: "commerce.orders"` vs `__ctxBrand: "commerce.payment"` is straightforward; making sure every method, constructor, and type reference uses the correct branded form takes care.

**Cycle detection algorithm.** Standard topological sort on the `consumes` graph, with cycle reporting via the cycle's path. Same pattern as existing graph algorithms; not architecturally novel but needs clean implementation.

### 8.4 What "done" looks like

1. All v0–v0.3 fixtures pass (regression).
2. All v0.4 fixtures pass (14 positive, 10 negative).
3. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` are clean.
4. The layered worked example (commerce.orders + commerce.payment + commons) compiles, with output that `tsc --noEmit --strict` accepts.
5. The TypeScript output for the layered example demonstrates per-context Money nominal distinction (different brands in `commerce.orders` and `commerce.payment` outputs).
6. Construction of a context-owned type from outside the context produces a clear type error.
7. Reference to a private (unexported) type from a consuming context produces a clear type error.

---

## 9. v0.5 preview (for context)

What's coming after v0.4:

The behavioural layer begins. v0.5 introduces:

1. **Agents within contexts** — stateful entities with handlers.
2. **Services within contexts** — the boundary interface, declaring callable operations.
3. **Handlers** — the implementation of service operations (`on call(args)` blocks).
4. **The `Effect[T]` type** — async effectful computations.
5. **Capabilities** — declared dependencies on platform/external services.
6. **The `given` clause** — capability injection at service operation declarations.
7. **Cross-context service calls** — using `consumes` declarations to actually invoke services in other contexts.

v0.5 is when Karn becomes a working service-tier language. v0.4 set up the architectural scaffolding (contexts, exports, dependencies, type identity); v0.5 fills in the behaviour.

v0.6+ will add:
- Providers and provider composition.
- Test contexts targeting contexts (third declaration kind).
- Standard library beyond v0.3's foundations.
- Wire-format infrastructure for cross-context calls.

After v0.5, the language has both layers (type structure + behaviour) and is recognisably the service-tier application language Karn was designed to be.
