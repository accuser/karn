# Karn v0.6 Grammar — Cross-Context Wiring

A delta specification introducing cross-context service calls, completing the deferred-from-v0.4 type-identity enforcement, and establishing the structural-projection semantics at context boundaries. Read all earlier specs first — `karn-mvp-grammar.md` through `karn-mvp-grammar-v0.5.md`.

The v0.6 compiler should accept every earlier program unchanged. All v0–v0.5 test fixtures must continue to pass.

After v0.6, contexts can call each other. The architecture round-trips: a commons defines vocabulary, contexts use it locally, contexts export selectively, contexts consume each other's services. The architectural commitments (encapsulation, per-context type identity, boundary projection) are enforced at compile time.

**Test contexts targeting contexts and cross-context capability resolution are deferred to v0.7.** Multi-Worker deployment with runtime serialisation across actual network boundaries is also deferred — v0.6 compiles all contexts to a single deployment unit.

---

## 1. Scope

### In scope for v0.6

- **Cross-context service call syntax** — `<context>.<service>(args)` and `<alias>.<service>(args)`.
- **Aliasing in `consumes` clauses** — `consumes commerce.payment as Payments`.
- **Type-identity enforcement at the checker** — the deferred-from-v0.4 work. Two contexts' rebranded versions of the same commons type are distinct nominal types; passing one where the other is expected requires structural projection.
- **Compile-time structural projection** at context boundaries — the checker verifies that values crossing a boundary have a structurally compatible target type; the runtime is identity (single deployment unit).
- **The `Effect[T]` propagation rule** extended to cross-context calls — a service call has type `Effect[Result[T, E]]` per the called service's signature.
- **Boundary failure handling via Effect** — when receiving-side validation would fail (e.g., refinement violation on a value crossing the boundary), the failure propagates through Effect. Explicit boundary-error capture is deferred to v0.7+.

### Out of scope for v0.6 (deferred to v0.7+)

- **Test contexts targeting contexts** — the third declaration kind. v0.7's primary feature; substantial enough to warrant its own increment.
- **Cross-context capability resolution** — a context exposing capabilities for other contexts to use. v0.6 keeps capabilities strictly intra-context.
- **Multi-Worker deployment** with runtime serialisation. v0.6 compiles to a single deployment unit; multi-Worker, fetch()-based cross-context invocation comes later.
- **Explicit boundary error handling at the type level** — surfacing structural-projection failures as typed errors. v0.6 propagates them through Effect.
- **Multiple service handler kinds** beyond `on call` (no `on http`, `on queue`, `on cron` yet).
- **Provider composition** (wrappers, decorators).
- **State machines** (agent state as a sum type).
- **Saga / compensation machinery.**
- **Standard library expansion beyond what's in v0.5.**

---

## 2. Updated lexical structure

### New reserved keywords

```
as
```

Only one. `as` is used in `consumes ... as <alias>` clauses to introduce a short name for a consumed context. All other lexical rules are unchanged from v0.5.

---

## 3. Updated grammar

### 3.1 The `consumes` clause with alias

```
consumes-decl ::= 'consumes' QualifiedName ('as' identifier)?
```

A `consumes` clause may optionally introduce an alias for the consumed context. The alias is in scope throughout the consuming context, used wherever a reference to the consumed context's service surface is needed.

Examples:

```
context commerce.orders

consumes commerce.payment                  -- access services as "commerce.payment.<service>"
consumes commerce.shipping as Shipping     -- access services as "Shipping.<service>"
```

A given context can mix both forms.

**Alias resolution rules:**

- The alias must be a valid PascalCase identifier (by convention) but the grammar accepts any identifier.
- The alias is in scope throughout the consuming context — in service handlers, agent handlers, type declarations (only as service-call expressions), and free functions if any.
- The alias must not conflict with any locally-declared name (type, function, capability, service, agent, alias). Conflicts are compile errors.
- The alias must not conflict with another `consumes ... as <alias>` in the same context.
- The alias does not affect the consumed context — it's purely a local naming convenience.

### 3.2 Cross-context service call syntax

```
postfix-op   ::= ...
              | '.' identifier '(' arg-list? ')'   -- method/service call (v0.2 grammar)

primary-expr ::= ...
              | qualified-service-call

qualified-service-call ::= QualifiedName '.' identifier '(' arg-list? ')'
                         | identifier '.' identifier '(' arg-list? ')'   -- when prefix is a context alias
```

Cross-context service calls reuse the existing method-call grammar. The compiler disambiguates: when the prefix (the part before the dot) resolves to a consumed context (or its alias), the call is a cross-context service call.

Examples:

```karn
let auth <- commerce.payment.authorise(amount)              -- fully qualified

consumes commerce.payment as Payments
let auth <- Payments.authorise(amount)                       -- via alias
```

Both forms parse identically; the resolver determines which interpretation applies based on the prefix's resolved meaning.

### 3.3 Updated full grammar — relevant productions

For reference, the changes in summary:

```
consumes-decl ::= 'consumes' QualifiedName ('as' identifier)?

-- Cross-context service calls use the existing postfix-op '.' identifier '(' args ')'
-- and primary-expr qualified-fn-call grammar from v0.2.
```

No other grammar productions change in v0.6. The new behaviour is in resolution and type-checking.

---

## 4. Updated static semantics

### 4.1 Resolving service call prefixes

When the compiler encounters `X.serviceName(args)`, it resolves `X` in the consuming context's scope. Possible resolutions:

1. **A type name** — `X.serviceName` is a static method call (existing v0.2 semantics).
2. **A value of a record type** — `X.serviceName` is an instance method call or field access (existing v0.2 semantics).
3. **A consumed context's qualified name** — `X.serviceName` is a cross-context service call.
4. **An alias from a `consumes ... as X` clause** — same as above.

When `X` resolves to multiple possibilities (e.g., both a local type and a consumed-context alias have the same name), the resolver reports an ambiguity error.

For `X.Y.serviceName(args)` (two-level qualification), `X.Y` must resolve to a consumed context's qualified name; `serviceName` must be a service in that context.

### 4.2 Cross-context service call resolution

For `<context>.<service>(args)`:

1. The context must appear in a `consumes` clause of the current context (or via an alias).
2. The service must exist in the consumed context.
3. The service must have an `on call` handler. (Other handler kinds — `on http`, `on queue` — are out of scope for v0.6.)
4. The argument count must match the handler's parameter count.
5. Each argument's type must be **structurally compatible** with the corresponding parameter's type (see §4.3).
6. The call's result type is `Effect[T]` where `T` is the handler's declared return type, with parameter types rebranded to the consuming context's namespace (so a returned `Money` is `commerce.orders.Money` when called from `commerce.orders`).

**Services are implicitly exported.** A context's services are part of its boundary contract by definition — there is no notion of a "private" service. The `exports` clause governs *types* (per v0.4); services are always callable from contexts that `consumes` the declaring context. A future version could add private/internal services for code organisation but the architectural commitment is that the service surface and the exported surface together form the context's contract, with services always public.

**Variant-name disambiguation (v0.6 limitation).** When a context declares a local sum type with a variant name `X`, and also consumes a context whose transparent sum exports a variant `X`, an unqualified reference to `X` is ambiguous. v0.6's resolver does not perform expected-type-driven disambiguation — it produces a `karn.resolve.ambiguous_variant` diagnostic and requires qualified construction (`LocalSum.X` or `ContextName.SumName.X`). A future version may add expected-type disambiguation (the standard rule used by Rust, Swift, and most modern sum-typed languages), which would resolve `X` based on the surrounding type context. For v0.6, qualified construction is the only mechanism for disambiguating.

### 4.3 Structural projection at boundaries

When a value crosses a context boundary (as a service-call argument or return value), its type must be **structurally compatible** between the two contexts. The compile-time check:

1. Both types are derived from the same commons declaration (mixed in via `uses` on both sides), *or*
2. Both types have identical structural shape (same fields with same names and structurally-compatible types, for records; same variants with same names and structurally-compatible payloads, for sums; same base type with consistent refinements, for refined values).

When types are structurally compatible:

- The compile-time type-check passes.
- The value is "projected" from the sending context's nominal type to the receiving context's nominal type.
- In v0.6's single-deployment model, this is an identity operation at runtime — no serialisation occurs.

When types are not structurally compatible (e.g., field names differ, variant counts differ, refinement constraints conflict):

- The compile-time type-check fails with a `karn.boundary.structural_mismatch` error.
- The error diagnostic shows both types' shapes and where they differ.

**Refinement compatibility:** A refined Int with `InRange(1, 100)` is structurally compatible with a refined Int with `InRange(1, 100)` (identical refinements) or with an unrefined Int (the receiving side is more permissive). It is *not* compatible with a refined Int with `InRange(1, 50)` (the receiving side is stricter, so values might violate). The compatibility rule is: sending side's value set must be a subset of receiving side's accepted value set.

For v0.6, the compatibility check is conservative — exact match on refinements is required for cross-context flow. A more sophisticated refinement-narrowing check can come later.

### 4.4 Per-context type identity (enforcement)

This is the deferred-from-v0.4 work, now reachable because v0.6 introduces call sites where the distinction matters.

For a commons declaration `type Money = { ... }`:

- Each context that mixes in `commerce.money` has its own nominal type derived from the commons declaration.
- `commerce.orders.Money` and `commerce.payment.Money` are *distinct nominal types* at the checker level.
- They are structurally compatible (per §4.3).

When the checker sees `commerce.payment.authorise(amount)` called from `commerce.orders`:

- `amount`'s type is `commerce.orders.Money` (the orders' nominal copy).
- The service expects a parameter of type `commerce.payment.Money` (the payment's nominal copy).
- The types are distinct nominal types but structurally compatible (both derive from the same commons).
- The boundary projection is admitted; the call type-checks.

If the user attempts to pass a value across the boundary that's not structurally compatible (e.g., a context's locally-declared record that happens to have similar fields), the call fails the type check.

### 4.5 Return-value rebranding

A service in `commerce.payment` declares `-> Effect[Result[AuthId, PaymentError]]`. When called from `commerce.orders`:

- The return type from the call site's perspective is `Effect[Result[commerce.orders.AuthId-equivalent, commerce.orders.PaymentError-equivalent]]`.
- If `AuthId` is declared locally in commerce.payment and exported (per v0.4 exports rules), the call-site type is `commerce.orders`-rebranded view of that exported type.
- If `PaymentError` is exported transparently, the consuming context can match on its variants.
- If `PaymentError` is exported opaquely, the consuming context can hold it but not inspect it.

In practice for v0.6:

```karn
let result <- commerce.payment.authorise(amount)
match result {
  Ok(authId) => { ... authId is opaque; can hold and pass around ... }
  Err(error) => match error {
    Declined => ...                   -- works because PaymentError is transparent
    InsufficientFunds => ...
    GatewayDown => ...
  }
}
```

### 4.6 Boundary failures and Effect propagation

In v0.6's single-deployment model, runtime boundary validation is structurally redundant (the same TS object satisfies both contexts' types). But the *language* models structural projection as a step that can fail, for two reasons:

1. Forward compatibility with multi-Worker deployment where actual serialisation/deserialisation introduces real failure modes.
2. Consistency in error handling — the user thinks about cross-context calls as potentially failing at the boundary.

For v0.6, boundary failures don't occur at runtime (no projection step happens). But the type system reserves the right to introduce them. The `Effect[T]` type's failure mode includes potential boundary failures; users handle them through the usual Effect machinery (which in v0.6 means propagation via `<-` without explicit catch).

**v0.7+ will add** explicit boundary-error capture syntax. For v0.6, boundary failures (in the rare cases they can be triggered, e.g., a context calling itself recursively with mocked types) propagate transparently.

### 4.7 Cycles between contexts

`consumes` cycles between contexts are forbidden (per v0.4 §4.5). This rule is unchanged in v0.6. The compiler detects cycles in the consumes graph and errors.

A cycle now has additional architectural meaning: contexts that consume each other cannot make synchronous service calls in both directions, because there's no well-defined ordering. The cycle prohibition reflects this.

---

## 5. Updated type system

### 5.1 Nominal type identity across contexts (now enforced)

The per-context nominal type identity from v0.4 §3.4 is now enforced at the checker. The implementation:

- Each context has its own symbol table with rebranded types (already done in v0.4).
- When the checker resolves a reference to a type name, it produces the local rebranded version.
- Service call argument typing applies the cross-context structural-projection rule (§4.3).
- Service call return typing rebrand-projects the return type into the calling context's namespace.

This is the type-system landing of v0.4's commitment, finally reachable in v0.6.

### 5.2 Service call as a typed expression form

A cross-context service call is an expression that produces an `Effect[T]` value:

```
<service-call>: Effect[<service-return-type-rebranded-to-caller>]
```

The expression appears wherever an Effect-typed expression is valid: in `<-` bindings, as the body of an effectful function, as an argument to another effectful operation. The standard Effect rules from v0.5 apply.

### 5.3 Type identity in TypeScript output

The TypeScript output (already from v0.4) carries the brand differentiation:

```typescript
// In commerce.orders's output:
export type Money = CommonsMoney & { readonly __ctxBrand: "commerce.orders" };

// In commerce.payment's output:
export type Money = CommonsMoney & { readonly __ctxBrand: "commerce.payment" };
```

For cross-context calls, the TypeScript compiler enforces the brand distinction via the intersection type. A call site that tries to pass `commerce.orders.Money` to a function expecting `commerce.payment.Money` fails the `tsc` check too — which is the right defence in depth.

But in single-deployment mode, the actual runtime value is the same object; the brand is purely a compile-time mechanism. The call site does an unchecked cast at the boundary (`value as commerce.payment.Money`), which is sound because the types are structurally identical.

---

## 6. Updated compilation to TypeScript

### 6.1 Cross-context service calls compile to imports + direct calls

A `consumes commerce.payment` declaration generates a TypeScript import:

```karn
context commerce.orders

consumes commerce.payment
```

Compiles to (in commerce.orders's output):

```typescript
import * as commerce_payment from "../payment";
```

(Or selectively named, depending on what's used.)

A service call:

```karn
let auth <- commerce.payment.authorise(amount)
```

Compiles to:

```typescript
const auth = await commerce_payment.authorise(amount as commerce_payment.Money, depsForPayment);
```

Two things to note:
- The `as commerce_payment.Money` cast performs the brand re-stamping (sound because of structural compatibility).
- `depsForPayment` is the payment context's capability bundle, assembled at the application's composition root.

### 6.2 Aliased consumes

```karn
consumes commerce.shipping as Shipping
```

Compiles to (in TypeScript):

```typescript
import * as Shipping from "../shipping";
```

The alias becomes the import binding name. Subsequent uses of `Shipping.dispatch(...)` compile to `Shipping.dispatch(...)`. Clean.

### 6.3 Service deps assembly

Each context's services need capability deps assembled. In v0.5, the deps were assembled at the local service-call site. In v0.6 with cross-context calls, deps assembly becomes a composition-root concern.

The compiler generates a `composeApp` function (or similar) per top-level deployment artefact:

```typescript
// generated composition root
import * as commerce_payment from "./commerce/payment";
import * as commerce_orders from "./commerce/orders";
// ... other contexts

export function composeApp() {
  // Each context's own providers instantiated for its own deps
  const paymentDeps = { 
    Payments: new commerce_payment.StubPayments(),
    Logger: new commerce_payment.ConsoleLogger(),
  };
  
  const ordersDeps = {
    Inventory: new commerce_orders.StubInventory(),
    // Plus any deps orders needs to make cross-context calls — typically nothing
    // because cross-context calls use the called context's own deps
  };
  
  return {
    payment: {
      authorise: (amount: commerce_payment.Money) => 
        commerce_payment.authorise(amount, paymentDeps),
      refund: (id: commerce_payment.AuthId) => 
        commerce_payment.refund(id, paymentDeps),
    },
    orders: {
      placeOrder: (items: commerce_orders.CartItem[]) =>
        commerce_orders.placeOrder(items, ordersDeps),
    },
  };
}
```

This is the application's entry-point glue. Karn generates it; the user supplies provider implementations (already done in v0.5's `provides` declarations).

### 6.4 Cross-context call mechanics

The generated import in commerce.orders gives access to `commerce_payment.authorise` (the bare service function). But that function needs `depsForPayment` to operate. Where does it come from?

Two options:
- **Pass deps from caller** — orders gets payment's deps from the composition root and passes them through.
- **Each context manages its own deps** — payment knows how to assemble its deps; orders just calls `paymentSurface.authorise(amount)` and the surface does the deps assembly.

Option B is cleaner. The compiler generates per-context "surface" objects that bundle service functions with their deps:

```typescript
// In commerce.payment's output:
export function makeSurface(deps: PaymentDeps) {
  return {
    authorise: (amount: Money) => authorise(amount, deps),
    refund: (id: AuthId) => refund(id, deps),
  };
}
```

In orders' output, the cross-context call becomes:

```typescript
// surface is passed in via orders' deps
const auth = await surface.payment.authorise(amount as commerce_payment.Money);
```

The composition root assembles each context's surface (with its deps) and threads them through:

```typescript
const paymentSurface = commerce_payment.makeSurface(paymentDeps);
const ordersDeps = { 
  ...ordersOwnCapabilities,
  surface: { payment: paymentSurface, /* etc */ }
};
```

This is verbose but mechanical. The compiler generates the glue; the user writes the Karn code.

### 6.5 Brand re-stamping at the boundary

The cast `value as commerce_payment.Money` at the call site is sound because:
- Both `commerce.orders.Money` and `commerce.payment.Money` are intersection types over the same `CommonsMoney` base.
- The structural shape is identical.
- Only the `__ctxBrand` differs (a compile-time-only field).

The cast removes orders' brand and adds payment's. At runtime, the value is unchanged.

For complex types (records containing other branded types, sums with branded payloads, generics over branded types), the cast applies recursively at the type level. TypeScript's type system handles this automatically given the intersection-type representation.

---

## 7. New test corpus

The v0.6 test corpus adds fixtures for cross-context calls and the boundary semantics.

### Positive fixtures (new for v0.6)

```
tests/positive/
├── 97_simple_cross_context_call/             -- A consumes B, A calls a B service
├── 98_cross_context_call_with_alias/         -- A consumes B as X, A calls X.service
├── 99_cross_context_with_money/              -- two contexts share commerce.money,
│                                                  one calls the other with a Money value
├── 100_cross_context_returned_type/          -- one context calls another, uses the return
├── 101_cross_context_chained/                -- A consumes B consumes C; A → B → C
├── 102_full_orders_payment_integration/      -- worked example: orders places an order,
│                                                  calling payment for authorisation
```

### Negative fixtures (new for v0.6)

```
tests/negative/
├── 75_call_not_consumed/                     -- A.service when A is not in consumes
├── 76_call_nonexistent_service/              -- A.notAService when A is consumed but
│                                                  notAService doesn't exist
├── 78_alias_conflicts_with_type/             -- consumes commerce.X as Money where Money
│                                                  is a local type
├── 79_alias_used_twice/                      -- two consumes ... as Foo
├── 80_structural_mismatch/                   -- pass an unrelated type at the boundary
├── 83_ambiguous_variant/                     -- unqualified variant when consumed
│                                                  transparent sum and local sum share the name
```

(Fixtures 77 and 81 from earlier drafts of this spec are not present:
- *Fixture 77 (call_private_service)* — removed because services are implicitly exported (§4.2); no valid case to exercise.
- *Fixture 81 (pass_private_context_type)* — removed because a private type is not referenceable from outside its context; the case collapses into fixture 80 (structural_mismatch).)

Fixture 82 (construct consumed type) remains valid:

```
├── 82_construct_consumed_type/               -- attempt to construct a consumed context's
                                                  exported type (only the owning context can)
```

### v0.6 worked example: orders ↔ payment integration

The end-to-end worked example: a commerce.orders context that calls commerce.payment for authorisation. Building on v0.5's worked examples, this completes the loop.

**`src/commerce/payment.karn`** (extends v0.5 with the service body intact):

```karn
---
Payment context. Authorises monetary transactions.
---
context commerce.payment

uses commerce.money
uses commerce.identifiers

exports opaque      { AuthId }
exports transparent { PaymentError }

type AuthId = opaque String where Matches("AUTH-[0-9]{8}")

type PaymentError = enum {
  Declined,
  InsufficientFunds,
  GatewayDown,
}

capability Payments {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]]
  fn refund(id: AuthId) -> Effect[Result[(), PaymentError]]
}

provides Payments = StubPayments {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
    if amount.minorUnits > 1000000 {
      Effect.pure(Err(Declined))
    } else {
      Effect.pure(Ok(AuthId.unsafe("AUTH-12345678")))
    }
  }
  
  fn refund(id: AuthId) -> Effect[Result[(), PaymentError]] {
    Effect.pure(Ok(()))
  }
}

---
Authorise a payment. The single entry point for payment authorisation
from other contexts.
---
service authorise {
  on call(amount: Money) -> Effect[Result[AuthId, PaymentError]] 
      given Payments {
    Payments.authorise(amount)
  }
}
```

**`src/commerce/orders.karn`** (uses v0.6 cross-context call):

```karn
---
Orders context. Places orders, calling payment for authorisation.
---
context commerce.orders

uses commerce.money
uses commerce.identifiers
consumes commerce.payment as Payment

exports opaque      { Order }
exports transparent { OrderError }

type OrderError = enum {
  PaymentDeclined,
  InsufficientFunds,
  PaymentInfrastructureError,
}

type Order = {
  id:     OrderId,
  total:  Money,
  authId: AuthId,                  -- the AuthId from payment, held as opaque
}

agent OrderEntity {
  key id: OrderId
  
  state {
    total:  Money,
    authId: Option[AuthId],
    placed: Bool,
  }
  
  ---
  Place an order by authorising payment for the total amount.
  ---
  on call place(total: Money) -> Effect[Result[Order, OrderError]] {
    -- Cross-context call: orders.Money projects to payment.Money structurally
    let auth <- Payment.authorise(total)
    
    match auth {
      Ok(authId) => {
        commit {
          total: total,
          authId: Some(authId),
          placed: true,
        }
        
        Ok(Order {
          id: self.id,
          total: total,
          authId: authId,
        })
      }
      Err(Declined) => Err(PaymentDeclined)
      Err(InsufficientFunds) => Err(InsufficientFunds)
      Err(GatewayDown) => Err(PaymentInfrastructureError)
    }
  }
}
```

This exercises:
- `consumes commerce.payment as Payment` with alias.
- Cross-context service call: `Payment.authorise(total)`.
- Boundary projection: `total: commerce.orders.Money` flows to a parameter expecting `commerce.payment.Money`.
- Returned opaque type: `AuthId` from payment is held in orders without inspection.
- Returned transparent sum type: `PaymentError` from payment is pattern-matched on its variants.
- Anti-corruption-layer pattern: orders maps payment's errors to its own `OrderError`.

The TypeScript output should compile under `tsc --noEmit --strict` and demonstrate distinct brands for orders' Money and payment's Money.

---

## 8. Implementation notes

### 8.1 Backwards compatibility

All v0–v0.5 fixtures must pass. The grammar additions are additive — the `as` keyword in `consumes` is optional. Existing `consumes commerce.payment` declarations remain valid; they just don't have an alias.

### 8.2 Where new code goes

- `lexer.rs`: new keyword `as`.
- `ast.rs`:
  - `ConsumesDecl` gains an optional `alias: Option<Ident>` field.
  - Service call expressions reuse the existing call-expression AST; the resolver determines the call kind.
- `parser.rs`: `consumes-decl` parser updated to handle the optional `as alias`.
- `project.rs`: aliases registered per consuming context; alias-conflict detection.
- `resolver.rs`:
  - When resolving a `<prefix>.<name>(...)` call, check if `<prefix>` is a consumed context (or alias). If so, treat as cross-context service call.
  - Cross-context service resolution: find the service in the consumed context; verify it has an `on call` handler; check it's not private.
- `checker.rs`:
  - The big new work: type-checking cross-context calls. Verify argument structural compatibility per §4.3. Rebrand the return type into the calling context's namespace.
  - The deferred-from-v0.4 nominal-distinction enforcement, now reachable.
- `emitter.rs`:
  - Generate import statements for consumed contexts.
  - Generate the brand-restamping cast at call sites.
  - Generate the per-context surface assembly.
  - Generate the composition-root glue (initially a single file per project).

### 8.3 Risk areas

- **Structural projection rules.** The compatibility check (§4.3) needs to walk types recursively — records into their fields, sums into their variants, generics into their parameters. Get the structure right; the implementation is straightforward but the edge cases are many (refined types, opaque types, types from different commons that happen to look identical).

- **Type identity at the checker.** This is the v0.4 deferred work. The per-context symbol tables already exist (from v0.4 implementation); the checker needs to actually use them for type comparison. Cases to handle: equal type names from different contexts, generic types parameterised by branded types, return-type rebranding.

- **Composition root generation.** The generated glue file needs to correctly assemble per-context surfaces with their respective deps. For projects with many contexts, this could be verbose. Worth getting the pattern right.

- **Cross-context error mapping.** When orders calls payment and payment returns `Err(Declined)`, orders maps that to its own `Err(PaymentDeclined)`. This pattern (Anti-Corruption Layer) is idiomatic and worth documenting in the worked example so users see it.

- **Project-level changes for composition.** The single-deployment-unit model means the project module needs to emit a composition root. Decide where it goes — `out/main.ts`? `out/compose.ts`? — and document it.

### 8.4 What "done" looks like

1. All v0–v0.5 fixtures pass (regression).
2. All v0.6 fixtures pass (6 positive, 8 negative).
3. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` are clean.
4. The orders ↔ payment worked example compiles, with TypeScript output accepted by `tsc --noEmit --strict`.
5. The emitted TypeScript demonstrates the per-context nominal distinction (different brands; cross-context call has the `as` cast).
6. A generated composition root exists and is structurally correct.
7. Cross-context call type errors produce clear diagnostics pointing at the structural mismatch.

---

## 9. v0.7 preview

What's coming after v0.6:

The third declaration kind: **test contexts targeting contexts**. Substantial enough to warrant its own increment.

```karn
test commerce.orders {
  -- Mock providers for testing
  mocks Payments = TestPayments {
    fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
      Effect.pure(Ok(AuthId.unsafe("TEST-AUTH")))
    }
  }
  
  test "placing an order succeeds when payment authorises" {
    let result <- OrderEntity(OrderId.unsafe("ORD-001")).place(...)
    assert result.isOk
  }
  
  test "order placement maps payment failures correctly" {
    -- swap in a mock that always declines
    mocks Payments = AlwaysDeclines { ... }
    
    let result <- ...
    assert result is Err(PaymentDeclined)
  }
}
```

v0.7 adds:
- `test` declaration targeting a context.
- `mocks` clauses for swapping providers in tests.
- Mocked consumes (replacing a real consumed context with a stub).
- `test "name" { ... }` blocks with assertions.
- Assertion machinery (`assert`, `expect`, etc.).
- A test runner integrated with `karnc test`.

v0.8+ probably adds:
- Cross-context capability resolution (a context exposing capabilities for other contexts).
- Multi-Worker deployment with runtime serialisation.
- Explicit boundary error handling.
- Additional handler kinds (`on http`, `on queue`, `on cron`).

After v0.7, Karn supports the full development cycle: write contexts, compose them, test them. v0.8+ adds production-deployment refinements.
