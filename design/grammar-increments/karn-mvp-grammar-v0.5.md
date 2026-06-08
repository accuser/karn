# Karn v0.5 Grammar — Behavioural Layer (Intra-Context)

A delta specification introducing the behavioural layer within a single context: agents, services, handlers, capabilities, the `given` clause, providers, and the `Effect[T]` type. This is the largest single increment in the language. Read all earlier specs first — **`karn-mvp-grammar.md`** through **`karn-mvp-grammar-v0.4.md`**.

The v0.5 compiler should accept every earlier program unchanged. All v0–v0.4 test fixtures must continue to pass.

v0.5 is intentionally *intra-context* in scope. It adds everything needed to write a working service entirely within one context — agents holding state, services exposing operations, capabilities injecting external dependencies, effects propagating async work. **Cross-context service calls are deferred to v0.6**, along with wire-format infrastructure, structural projection at boundaries, and the type-identity-enforcement work deferred from v0.4. v0.5 sets up a context's complete internal behaviour; v0.6 makes contexts talk to each other.

After v0.5, you can write a working stateless Karn service end-to-end within a single context. After v0.6, contexts can call each other.

---

## 1. Scope

### In scope for v0.5

The behavioural surface within a context:
- **The `Effect[T]` type** — built-in generic for async effectful computations.
- **The `<-` operator** — unwrap an `Effect[T]` to `T` within an effectful context.
- **Capability declarations** — `capability Logger { ... }` — interface-like contracts for external dependencies.
- **Provider declarations** — `provides Logger = ConsoleLogger` — implementations of capabilities.
- **The `given` clause** — `on call(...) given Logger, Time { ... }` — explicit capability injection at handler sites.
- **Service declarations** — `service authorise { on call(args) -> ... { ... } }` — the boundary interface.
- **Agent declarations** — `agent Order { state { ... } on call ... }` — state-bearing entities with handlers.
- **The `commit` statement** — within an agent handler, declares the new state to persist.
- **Record spread expression** — `{ ...existing, field: newValue }` — for ergonomic state updates and record extension.

### Out of scope for v0.5 (deferred to v0.6+)

- **Cross-context service calls.** A context can `consumes` another (declared in v0.4) but cannot yet invoke services across the boundary.
- **The deferred type-identity enforcement** from v0.4 — comes due with cross-context calls.
- **Wire-format infrastructure** for cross-context serialisation/deserialisation.
- **Test contexts targeting contexts** (third declaration kind for contexts; still only commons-targeted tests).
- **Provider composition** (wrapper providers, decorator pattern). v0.5 has direct providers only.
- **Multiple handler kinds.** v0.5 has only `on call(...)` (typed RPC). HTTP, queue, cron handlers come later.
- **State machines as sums** — declaring agent state as a sum type (state-machine style). v0.5's agent state is a record only.
- **Compensations and sagas.**
- **Idempotency machinery beyond what handlers explicitly express.**

The constraints inherited from v0–v0.4 carry forward: nominal typing throughout, no overloading, no extension methods, no user-defined generics.

---

## 2. Updated lexical structure

### New reserved keywords

```
agent       capability  commit      Effect      given
on          provides    service     state
```

Each introduces a new declaration form or syntactic construct. The `Effect` keyword is reserved as a type constructor (parallel to `Result` and `Option` from earlier versions). `state` is the keyword for an agent's state block. `commit` is a statement keyword used inside agent handlers.

### New operator

The `<-` operator (left-arrow bind) is added. Used to unwrap an `Effect[T]` value within an effectful context. Distinct from `=` (assignment / let binding) and `->` (function return type).

All other lexical rules are unchanged from v0.4.

---

## 3. Updated grammar

### 3.1 The `Effect[T]` type

```
generic-type-ref ::= 'Result' '[' type-ref ',' type-ref ']'
                   | 'Option' '[' type-ref ']'
                   | 'Effect' '[' type-ref ']'        -- NEW in v0.5
```

`Effect[T]` represents an asynchronous, potentially effectful computation that produces a value of type `T`. Typical instances:
- `Effect[Result[AuthId, PaymentError]]` — an async operation that may succeed or fail.
- `Effect[()]` — an async operation with no return value (where `()` is the unit type).
- `Effect[String]` — an async operation returning a string (no error case).

In practice, the most common shape is `Effect[Result[T, E]]` — async work that returns a Result.

### 3.2 The `<-` operator (Effect bind)

The `<-` operator extracts the value from an `Effect[T]` within an effectful context (a handler body, a capability method body, or a service operation):

```
let-stmt ::= 'let' identifier (':' type-ref)? '=' expr       -- pure let (v0.1)
           | 'let' identifier (':' type-ref)? '<-' expr      -- effectful let (NEW in v0.5)
```

Semantics:
- `let x <- expr` requires `expr` to have type `Effect[T]` for some `T`.
- After the statement, `x` has type `T`.
- The enclosing scope (block) must itself be effectful (return `Effect[U]` for some `U`).
- Chaining with `?` is permitted: `let auth <- Payments.authorise(amount)?` first unwraps the `Effect`, then propagates `Err` from the inner `Result`.

`<-` is sometimes called "bind" or "await" in other languages. The semantics are `await`-like — the handler suspends until the Effect completes.

### 3.3 Capability declarations

A `capability` declares an interface for an external dependency. Capabilities can be declared at the top level of a context (alongside types and services):

```
capability-decl ::= doc-block? 'capability' identifier '{' capability-op+ '}'

capability-op   ::= doc-block? 'fn' identifier '(' param-list? ')' '->' type-ref
```

A capability has one or more operations. Each operation is declared like a function signature (no body — the capability is the contract, providers supply implementations). Operations typically return `Effect[Result[T, E]]` or `Effect[T]`.

Example:

```
capability Logger {
  fn log(message: String) -> Effect[()]
  fn error(message: String) -> Effect[()]
}

capability Payments {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]]
  fn refund(id: AuthId) -> Effect[Result[(), PaymentError]]
}
```

A capability's name is in scope within the context. It's not a type per se — you cannot have a variable of "type Logger." Capabilities are *injected* at handler sites via the `given` clause; they are never first-class values.

### 3.4 Provider declarations

A `provides` declaration supplies an implementation for a capability:

```
provider-decl ::= doc-block? 'provides' identifier '=' identifier '{' provider-body '}'

provider-body ::= provider-op+

provider-op   ::= 'fn' identifier '(' param-list? ')' '->' type-ref block
```

Semantics:
- The first identifier is the capability being provided.
- The second identifier is the name of this provider (used in tests and configuration to select implementations).
- The body contains one operation per capability operation, matching signatures exactly.

Example:

```
provides Logger = ConsoleLogger {
  fn log(message: String) -> Effect[()] {
    -- runtime-level effect; in v0.5 the body is illustrative.
    -- Real providers will use platform calls.
    Effect.pure(())
  }
  
  fn error(message: String) -> Effect[()] {
    Effect.pure(())
  }
}
```

For v0.5, a provider must implement every capability operation. Provider operations have the same signature constraints as capability operations.

A context with a `provides` declaration is *self-providing* for that capability — any handler in the context with `given Logger` resolves to this provider. Future versions (v0.6+) add provider composition (wrappers around providers), provider selection by configuration, and cross-context provider resolution.

### 3.5 Service declarations

A `service` declares a callable operation as part of a context's boundary:

```
service-decl  ::= doc-block? 'service' identifier '{' handler-block+ '}'

handler-block ::= doc-block? 'on' handler-kind '(' param-list? ')' return-spec? 
                  given-clause? block

handler-kind  ::= 'call'

return-spec   ::= '->' type-ref

given-clause  ::= 'given' identifier (',' identifier)*
```

A service has one or more handler blocks. Each handler block declares how a particular kind of invocation is handled. For v0.5, only `on call(...)` is supported — typed RPC-style invocation. HTTP, queue, and other handler kinds come in later versions.

Example:

```
service authorise {
  on call(amount: Money) -> Effect[Result[AuthId, PaymentError]] 
      given Payments, Logger {
    let _ <- Logger.log("Authorising payment")
    let result <- Payments.authorise(amount)
    result
  }
}
```

The handler body is a block (per v0.2's block grammar). The return type must be `Effect[T]` for some `T` — services are inherently effectful. The `given` clause lists capabilities used in the body.

**The given clause is explicit, not inferred.** The compiler verifies that:
- Every capability listed in `given` is used in the body.
- Every capability used in the body is listed in `given`.

Both directions are checked. Underdeclaring (using a capability not in `given`) is a compile error; overdeclaring (listing one not used) is a warning. This makes the dependency surface of every handler visible at its declaration.

### 3.6 Agent declarations

An `agent` declares a stateful entity with its own handlers:

```
agent-decl    ::= doc-block? 'agent' identifier '{' agent-body '}'

agent-body    ::= agent-key state-block agent-handler+

agent-key     ::= 'key' identifier ':' type-ref

state-block   ::= 'state' '{' field-list '}'

agent-handler ::= doc-block? 'on' handler-kind '(' param-list? ')' return-spec? 
                  given-clause? block
```

An agent has:
- A **key** — an identifier-typed value that identifies one instance from another. Each agent instance has a unique key value.
- A **state block** — a record-shaped declaration of the persistent state. The state is structured as fields.
- One or more **handlers** — each invocable per-instance.

Example:

```
agent Order {
  key id: OrderId
  
  state {
    status:   OrderStatus,
    items:    Int,                    -- placeholder for List[CartItem]
    total:    Money,
    placedAt: Timestamp,
  }
  
  on call addItem(item: CartItem) -> Effect[Result[(), OrderError]] 
      given Inventory {
    let stock <- Inventory.check(item.productId)?
    if stock < item.quantity {
      Err(OutOfStock)
    } else {
      commit {
        ...self.state,
        items: self.state.items + item.quantity,
        total: self.state.total.add(item.unitPrice)?,
      }
      Ok(())
    }
  }
  
  on call status() -> Effect[OrderStatus] {
    self.state.status
  }
}
```

Inside an agent handler:
- `self.key` resolves to the key value (`self.id` for the agent above).
- `self.state` resolves to the current state record.
- `commit newState` (the `commit` statement, see §3.7) updates the persisted state.
- Capabilities in the `given` clause are accessible by name.

**Key types.** The agent's key type must be opaque, refined, or a base type. It must support equality (which all types in Karn do). The key identifies the agent instance — same key means same instance.

**State immutability.** State fields are immutable from the handler's perspective. There is no field assignment (no `self.state.items = ...`). Updates happen exclusively through `commit`, which atomically replaces the state.

### 3.7 The `commit` statement

```
statement ::= let-stmt
            | commit-stmt

commit-stmt ::= 'commit' expr
```

The `commit` statement updates the persisted state of the enclosing agent handler. The expression must produce a value of the agent's state type. After `commit`, the handler can continue executing; the new state takes effect after the handler returns successfully.

Semantics:
- `commit` is only valid inside an agent handler (compile error elsewhere).
- The expression's type must match the agent's state type exactly (no widening, no subtyping).
- At most one `commit` per handler invocation. Multiple `commit` statements in different branches are fine (only one executes); two `commit` statements both reachable in one execution is a compile error.
- If a handler returns without `commit`, the state remains unchanged.
- If a handler returns `Err(...)` (in a `Result`-returning handler), the state remains unchanged regardless of `commit` — failure rolls back.

The `commit` statement is part of the handler's expression flow; it doesn't terminate the handler. Typically it appears near the end of a successful path, before the final `Ok(...)`.

### 3.8 Record spread expression

```
record-construction ::= identifier '{' field-init-list '}'                 -- v0.2
                      | identifier '{' '...' expr (',' field-init)* '}'   -- NEW spread form

-- The spread expression may also appear bare:
expr ::= ... | record-spread

record-spread ::= '{' '...' expr (',' field-init)* '}'
```

Record spread takes an existing record and produces a new one with specific fields replaced. The base expression must have a record type; the explicit field overrides must match the record's fields by name and type.

Examples:

```
let updated = State { ...self.state, items: self.state.items + 1 }

let zeroed = Money { ...moneyValue, minorUnits: 0 }
```

The bare form (without type prefix) is used inside `commit` when the state type is implied:

```
commit { ...self.state, items: self.state.items + 1 }
```

Spread is shallow — only the top-level fields are taken. Nested records are not deep-merged.

### 3.9 Updated grammar — context body items

```
context-item ::= doc-block? type-decl
               | doc-block? fn-decl
               | doc-block? capability-decl       -- NEW v0.5
               | doc-block? provider-decl         -- NEW v0.5
               | doc-block? service-decl          -- NEW v0.5
               | doc-block? agent-decl            -- NEW v0.5
               | uses-decl
               | consumes-decl
               | exports-decl
```

Commons body items are unchanged — commons cannot declare capabilities, providers, services, or agents (per the type system spec). Only contexts have behaviour.

### 3.10 Updated full expression grammar

Selected new productions for clarity:

```
let-stmt ::= 'let' identifier (':' type-ref)? '=' expr      -- pure
           | 'let' identifier (':' type-ref)? '<-' expr     -- effectful

commit-stmt ::= 'commit' expr

statement ::= let-stmt
            | commit-stmt

primary-expr ::= ...
              | record-spread

record-spread ::= '{' '...' expr (',' field-init)* '}'
```

---

## 4. Updated static semantics

### 4.1 Effect propagation rules

A function or handler body is *effectful* if it returns `Effect[T]` for some `T`. Inside an effectful body:
- `<-` can be used to unwrap `Effect[U]` values.
- Calls to capability operations (which always return `Effect[T]`) are permitted.
- Calls to other effectful functions are permitted.

Inside a *pure* body (one that returns a non-Effect type):
- `<-` is a compile error.
- Calls to capability operations are a compile error.
- Calls to effectful functions are a compile error.

This is the *infectiousness* property: effects propagate. A function that calls an effectful function must itself be effectful. There is no implicit unwrapping.

**Why this matters.** The boundary between pure and effectful code is visible at every function signature. A reader can tell whether a function performs I/O without reading its body. This is the same property that monadic effect tracking provides in Haskell/PureScript and that algebraic-effect systems (Koka, Eff) provide more directly.

### 4.2 `given` clause verification

For a handler with `given C1, C2, ..., Cn`:
- Each Ci must be a capability declared in the same context.
- Each Ci must be used at least once in the handler body (a name reference to Ci or one of its operations).
- Every capability operation invoked in the body must have its capability listed in `given`.
- No duplicates in the list.

The compiler builds the usage set from the body and compares to the declared set. Mismatches:
- Capability used but not declared: compile error (`karn.given.undeclared_capability`).
- Capability declared but not used: warning (`karn.given.unused_capability`).

### 4.3 `commit` statement validation

A `commit expr` is valid only when:
1. The enclosing handler is an agent handler (not a service handler, not a free function).
2. `expr` has the agent's state type exactly.
3. No other reachable `commit` in the same execution path.

The compiler performs control-flow analysis to detect "two reachable commits." Different branches of an `if`/`else` or `match` each allow their own `commit`, but two commits sequentially in the same flow is an error.

### 4.4 Agent handler return signature

An agent handler `on call name(args) -> Effect[Result[T, E]] { body }` has the following implicit contract:
- The handler's return value is the response to the caller.
- The handler's `commit` (if any) is the state change.
- If the handler returns `Ok(...)`, the committed state (or unchanged state if no commit) is persisted.
- If the handler returns `Err(...)`, the state is rolled back regardless of commit.

This is the transactional semantic: state changes are atomic with the handler's outcome. Either both the new state and the successful response are visible, or neither.

For handlers returning `Effect[T]` (no Result wrapper), there is no rollback semantic — `commit` always persists. This shape is for handlers that "always succeed" (e.g., a status-query handler that just reads state).

### 4.5 Provider/capability matching

For `provides C = ProviderName { ops }`:
- `C` must be a capability declared in the same context.
- Each capability operation in `C` must have a corresponding operation in the provider body.
- The signatures must match exactly (same name, same parameters, same return type).
- No extra operations beyond what `C` declares.

A capability with no provider in the same context is a "consumed capability" — it must be supplied by some other mechanism (in v0.5, this means tests; in later versions, cross-context capability sharing).

### 4.6 Record spread typing

For `{ ...base, field: value, ... }`:
- `base` must have a record type `T`.
- Each explicit override field must exist in `T`'s field set.
- Each override value's type must match the field's declared type.
- The result is a new value of type `T` with the specified fields replaced and all other fields taken from `base`.

For the type-prefixed form `T { ...base, ... }`, the prefix `T` is redundant when `base`'s type already determines it. The form is supported for clarity.

---

## 5. Updated type system

### 5.1 `Effect[T]` semantics

`Effect[T]` is a built-in generic type. It represents a deferred async computation. Two operations are defined:
- *Bind* (`<-`): unwrap to `T` within an effectful context.
- *Pure* (`Effect.pure(value)`): wrap a non-effectful value into `Effect[T]`. Used in provider bodies where the implementation is synchronous but the signature must return `Effect`.

`Effect[T]` is *not* equivalent to `Promise<T>` at the type level. The compilation to TypeScript uses Promise, but the Karn type system treats Effect as an opaque generic with these two operations.

### 5.2 Agent state as a nominal type

An agent's state block declares an implicit record type with the same name as the agent (the convention) or with a derived name. Within the agent body, `self.state` has this type.

For the worked example:

```
agent Order {
  state {
    status: OrderStatus,
    items: Int,
    total: Money,
  }
}
```

The state type is `Order.State` (or just `OrderState` in scope). It's a nominal record type with three fields.

External code cannot construct `Order.State` (per the encapsulation rule from v0.4). Only the agent's handlers can produce values via record construction or spread.

### 5.3 Service and agent type identity

A service is not a value. It's a declaration that produces callable handlers. The service operation `commerce.payment.authorise` is a name addressable from inside the context; v0.5 does not yet allow calling it from outside the context (cross-context calls come in v0.6).

An agent is also not a value. An agent reference (`Order(orderId)`) is a value that refers to an agent instance. In v0.5, agent references are only valid within the agent's defining context. The syntax `AgentName(key)` constructs the reference; calling methods on it invokes handlers (e.g., `Order(id).addItem(item)`).

For v0.5, agent invocation from within the same context is supported. Cross-context invocation comes in v0.6.

---

## 6. Updated compilation to TypeScript

### 6.1 Effect[T] compiles to Promise

`Effect[T]` lowers to `Promise<T>` in TypeScript:

```
fn capabilityOp(arg: String) -> Effect[Result[Foo, Bar]]
```

Compiles to:

```typescript
function capabilityOp(arg: string): Promise<Result<Foo, Bar>>
```

`<-` compiles to `await`:

```
let x <- effectfulOp()
```

Compiles to:

```typescript
const x = await effectfulOp();
```

`Effect.pure(value)` compiles to `Promise.resolve(value)`.

### 6.2 Capabilities compile to TypeScript interfaces

A capability declaration compiles to an interface plus a runtime injection token:

```karn
capability Logger {
  fn log(message: String) -> Effect[()]
  fn error(message: String) -> Effect[()]
}
```

Compiles to:

```typescript
export interface Logger {
  log(message: string): Promise<void>;
  error(message: string): Promise<void>;
}

export const Logger = Symbol("Logger") as InjectionToken<Logger>;
```

The symbol is used by the runtime injection system to map providers to capabilities at handler invocation time.

### 6.3 Providers compile to classes implementing interfaces

```karn
provides Logger = ConsoleLogger {
  fn log(message: String) -> Effect[()] {
    Effect.pure(())
  }
  fn error(message: String) -> Effect[()] {
    Effect.pure(())
  }
}
```

Compiles to:

```typescript
export class ConsoleLogger implements Logger {
  async log(message: string): Promise<void> {
    return Promise.resolve(undefined);
  }
  async error(message: string): Promise<void> {
    return Promise.resolve(undefined);
  }
}

export const ConsoleLoggerProvider: Provider<Logger> = {
  token: Logger,
  factory: () => new ConsoleLogger(),
};
```

The provider object pairs the capability token with a factory function. The runtime uses this to instantiate the provider when a handler with `given Logger` is invoked.

### 6.4 Service handlers compile to exported async functions

```karn
service authorise {
  on call(amount: Money) -> Effect[Result[AuthId, PaymentError]] 
      given Payments, Logger {
    let _ <- Logger.log("Authorising payment")
    let result <- Payments.authorise(amount)
    result
  }
}
```

Compiles to (within the context's module):

```typescript
export const authorise = {
  async call(
    amount: Money,
    deps: { Payments: Payments; Logger: Logger }
  ): Promise<Result<AuthId, PaymentError>> {
    await deps.Logger.log("Authorising payment");
    const result = await deps.Payments.authorise(amount);
    return result;
  }
};
```

The `given` clause becomes a `deps` parameter — an object with the capabilities. The caller (in the context's own composition root, or in v0.6's cross-context call infrastructure) supplies these.

### 6.5 Agents compile to Durable Object classes

```karn
agent Order {
  key id: OrderId
  
  state {
    status: OrderStatus,
    items: Int,
    total: Money,
  }
  
  on call addItem(item: CartItem) -> Effect[Result[(), OrderError]] 
      given Inventory {
    let stock <- Inventory.check(item.productId)?
    if stock < item.quantity {
      Err(OutOfStock)
    } else {
      commit {
        ...self.state,
        items: self.state.items + item.quantity,
        total: self.state.total.add(item.unitPrice)?,
      }
      Ok(())
    }
  }
}
```

Compiles to:

```typescript
export class Order {
  state: DurableObjectState;
  // The runtime injects deps when handlers are invoked
  
  constructor(state: DurableObjectState) {
    this.state = state;
  }
  
  async addItem(
    item: CartItem,
    deps: { Inventory: Inventory }
  ): Promise<Result<void, OrderError>> {
    const currentState = await this.loadState();
    
    const stockResult = await deps.Inventory.check(item.productId);
    if (!stockResult.ok) return stockResult;
    const stock = stockResult.value;
    
    if (stock < item.quantity) {
      return Err(OrderError.OutOfStock);
    } else {
      const totalResult = currentState.total.add(item.unitPrice);
      if (!totalResult.ok) return Err(totalResult.error);
      
      const newState = {
        ...currentState,
        items: currentState.items + item.quantity,
        total: totalResult.value,
      };
      
      await this.commitState(newState);
      return Ok(undefined);
    }
  }
  
  private async loadState(): Promise<OrderState> { /* ... */ }
  private async commitState(state: OrderState): Promise<void> { /* ... */ }
}
```

The DO state is persisted via the Durable Object storage API; the `commit` statement maps to `this.commitState(newState)`. The `self.state` reference maps to `currentState` (loaded at handler entry).

This is verbose but mechanical. The compiler generates the state loading/persisting boilerplate; the user just writes Karn handler bodies.

### 6.6 Record spread compiles directly

```
{ ...self.state, items: self.state.items + 1 }
```

Compiles to:

```typescript
{ ...currentState, items: currentState.items + 1 }
```

JavaScript's spread operator does exactly what Karn's spread does.

---

## 7. New test corpus

The v0.5 test corpus adds substantial fixtures. All v0–v0.4 fixtures must continue to pass.

### Positive fixtures (new for v0.5)

```
tests/positive/
├── 80_effect_type/                       -- Effect[T] in return position
├── 81_pure_let_arrow_let/                -- distinguish = and <- in lets
├── 82_capability_declaration/            -- declare a capability
├── 83_provider_basic/                    -- provides a capability
├── 84_provider_matches_capability/       -- signature matching
├── 85_service_simple/                    -- service with one handler
├── 86_service_with_given/                -- handler using capabilities
├── 87_service_chained_effects/           -- multiple <- in handler
├── 88_service_with_result_propagation/   -- combined <- and ?
├── 89_agent_basic/                       -- declare agent with state
├── 90_agent_handler_reads_state/         -- handler accessing self.state
├── 91_agent_handler_commits/             -- handler using commit
├── 92_agent_conditional_commit/          -- commit in if branch only
├── 93_record_spread_basic/               -- { ...base, field: value }
├── 94_record_spread_in_commit/           -- commit with spread
├── 95_full_payment_service/              -- worked example: payment context with service + capability
├── 96_full_order_agent/                  -- worked example: orders context with agent
```

### Negative fixtures (new for v0.5)

```
tests/negative/
├── 62_effect_in_pure_fn/                 -- <- in a non-Effect function
├── 63_arrow_let_on_non_effect/           -- let x <- pureValue
├── 64_capability_outside_context/        -- capability declared in commons
├── 65_given_undeclared_capability/       -- using a capability not in given
├── 66_given_unused_capability/           -- listing capability not used (warning)
├── 67_provider_missing_operation/        -- provider doesn't implement all of capability
├── 68_provider_signature_mismatch/       -- provider operation has wrong signature
├── 69_commit_outside_agent/              -- commit in service or free function
├── 70_two_reachable_commits/             -- two commits in same execution path
├── 71_commit_wrong_state_type/           -- commit produces wrong type
├── 72_state_field_assignment/            -- self.state.x = value (mutation not allowed)
├── 73_record_spread_unknown_field/       -- override field that doesn't exist
├── 74_record_spread_wrong_type/          -- override value has wrong type
```

### v0.5 worked example: a payment service

The worked example extends commerce.payment from v0.4 with a working service and capability:

```karn
---
Payment context. Authorises monetary transactions via a Payments capability.
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

---
External payment gateway capability. Production providers wrap real APIs;
test providers can substitute deterministic implementations.
---
capability Payments {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]]
  fn refund(id: AuthId) -> Effect[Result[(), PaymentError]]
}

---
A logger capability, used for observability.
---
capability Logger {
  fn log(message: String) -> Effect[()]
  fn error(message: String) -> Effect[()]
}

---
A stub provider for the Payments capability — always declines.
Production code will swap in a real provider.
---
provides Payments = StubPayments {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
    Effect.pure(Err(Declined))
  }
  
  fn refund(id: AuthId) -> Effect[Result[(), PaymentError]] {
    Effect.pure(Ok(()))
  }
}

---
Console logger provider. Bodies are minimal in v0.5; v0.6+ will tie 
into platform logging.
---
provides Logger = ConsoleLogger {
  fn log(message: String) -> Effect[()] {
    Effect.pure(())
  }
  
  fn error(message: String) -> Effect[()] {
    Effect.pure(())
  }
}

---
The authorise service: validates the amount and delegates to the
Payments capability. Errors propagate via the Result type.
---
service authorise {
  on call(amount: Money) -> Effect[Result[AuthId, PaymentError]] 
      given Payments, Logger {
    let _ <- Logger.log("Authorising payment")
    let result <- Payments.authorise(amount)
    
    match result {
      Ok(authId) => {
        let _ <- Logger.log("Authorisation succeeded")
        Ok(authId)
      }
      Err(err) => {
        let _ <- Logger.error("Authorisation failed")
        Err(err)
      }
    }
  }
}
```

And an order context with an agent:

```karn
---
Orders context. Each order is an agent instance keyed by OrderId.
---
context commerce.orders

uses commerce.money
uses commerce.identifiers
uses karn.time
consumes commerce.payment

exports opaque      { Order }
exports transparent { OrderError, OrderStatus }

type OrderError = enum {
  EmptyCart,
  TooManyItems,
  OutOfStock,
}

type OrderStatus = enum {
  Pending,
  Placed,
  Cancelled,
}

type CartItem = {
  productId: CustomerId,         -- placeholder
  quantity:  Int where InRange(1, 99),
  unitPrice: Money,
}

---
A simple inventory-check capability. In production, wraps a database query.
---
capability Inventory {
  fn check(productId: CustomerId) -> Effect[Result[Int, OrderError]]
}

provides Inventory = StubInventory {
  fn check(productId: CustomerId) -> Effect[Result[Int, OrderError]] {
    Effect.pure(Ok(100))     -- pretend everything's in stock
  }
}

---
An order agent. Each instance holds the state of one order.
---
agent Order {
  key id: OrderId
  
  state {
    status:   OrderStatus,
    items:    Int,                  -- placeholder for List[CartItem]
    total:    Money,
    placedAt: Timestamp,
  }
  
  ---
  Add an item to the order. Fails if inventory is insufficient or the order
  has reached the item limit.
  ---
  on call addItem(item: CartItem) -> Effect[Result[(), OrderError]] 
      given Inventory {
    let stockResult <- Inventory.check(item.productId)
    let stock = stockResult?
    
    if stock < item.quantity {
      Err(OutOfStock)
    } else if self.state.items >= 50 {
      Err(TooManyItems)
    } else {
      let newTotal = self.state.total.add(item.unitPrice)?
      
      commit {
        ...self.state,
        items: self.state.items + item.quantity,
        total: newTotal,
      }
      
      Ok(())
    }
  }
  
  ---
  Query the current order status without modifying state.
  ---
  on call status() -> Effect[OrderStatus] {
    self.state.status
  }
}
```

These examples exercise:
- Capabilities and providers.
- Services with `given` clauses.
- Agents with state and `commit`.
- `<-` for Effect unwrapping.
- `?` for Result propagation.
- Record spread for state updates.
- The full layered architecture from v0.4 (commons + contexts + consumes).

Note that the orders context `consumes commerce.payment`, but does not yet *call* into it — cross-context invocation comes in v0.6. v0.5's exercise of `consumes` is limited to the type-visibility surface set up in v0.4.

---

## 8. Implementation notes

### 8.1 Backwards compatibility

All v0–v0.4 fixtures must pass. The grammar additions are additive. Contexts gain new body item kinds; commons remain restricted to types, functions, and `uses`.

### 8.2 Where new code goes

- `lexer.rs`: new keywords (`agent`, `capability`, `commit`, `Effect`, `given`, `on`, `provides`, `service`, `state`); new operator (`<-`).
- `ast.rs`: 
  - `Capability`, `Provider`, `Service`, `Agent` declarations.
  - `Handler` AST node.
  - `Statement::Commit(...)` and `Statement::EffectLet(...)`.
  - `Expr::RecordSpread(...)`.
  - `TypeExpr::Effect(Box<TypeExpr>)`.
- `parser.rs`: 
  - Each new declaration form.
  - Handler bodies with the `given` clause.
  - The `<-` operator at let-statement level.
  - Record spread expressions.
- `resolver.rs`: 
  - Per-context capability table.
  - Per-context provider table (with capability matching).
  - Service and agent registration.
  - The `self.state` and `self.key` references inside agent handlers.
- `checker.rs`: 
  - Effect propagation rules.
  - `given` clause verification (used set matches declared set).
  - `commit` flow analysis.
  - Agent state typing.
  - Provider signature matching against capability signatures.
- `emitter.rs`: 
  - Effect → Promise lowering.
  - Capabilities → interface + injection token.
  - Providers → class + provider object.
  - Services → exported async functions taking dep object.
  - Agents → Durable Object classes with state load/commit machinery.
  - Record spread → JS spread.

### 8.3 Risk areas

This is the largest v0.5 risk surface:

**Effect propagation analysis.** The checker needs to track which expressions and statements are effectful and enforce that effectful operations only appear in effectful contexts. The cleanest implementation is a per-function "effect mode" flag that gets propagated through type-checking. Be careful with mixed expressions (an `if` whose branches have different effect status, etc.).

**The `given` clause's bidirectional check.** Used-set ⊆ declared-set is straightforward (every capability use is permitted). Declared-set ⊆ used-set requires scanning the handler body for capability references — straightforward but adds a pass.

**Commit flow analysis.** Detecting "two reachable commits" requires control-flow analysis. The simplest approach: at each program point, track "has commit been issued yet?" and detect commits when the flag is already true. Branches of `if`/`else` are joined by taking the OR (commit on this path implies commit if you went down it). The simplest correct algorithm is sufficient — don't over-engineer.

**Durable Object emission.** Cloudflare Durable Objects have a specific class shape and lifecycle. The emitted classes must match. The state loading/commit boilerplate is mechanical but needs to be correct. Consider keeping it in a separate emitter module for clarity.

**Capability injection lowering.** The `deps` object pattern (passing capabilities as a parameter) is simple but verbose. Each handler signature gets a `deps` parameter; the runtime composes the dep object at call time. The compiler must consistently generate the right shape.

**Record spread typing.** The spread operator's typing rule requires matching the spreader's type and the override types. Straightforward but a common error source for users; diagnostics must be clear.

### 8.4 What "done" looks like

1. All v0–v0.4 fixtures pass (regression).
2. All v0.5 fixtures pass (17 positive, 13 negative).
3. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` are clean.
4. The payment-service worked example compiles, with output that `tsc --noEmit --strict` accepts.
5. The orders-agent worked example compiles similarly.
6. The emitted Durable Object class is structurally well-formed (right constructor signature, right state-handling shape).

---

## 9. Design choices and open questions

This spec commits to several design choices that have alternatives. Each is called out here for visibility — if you disagree with a choice, push back before implementation.

### 9.1 Committed choices

- **Effect[T] is infectious.** A function returning Effect[T] can only be called within an effectful body. No implicit lifting.
- **`<-` operator for Effect unwrapping.** Distinct from `=`. Other choices considered: `await` keyword (more familiar but mixes with async/await connotations), `!` postfix operator (terse but cryptic).
- **`given` clause is explicit.** Compiler verifies both directions (used ⊆ declared, declared ⊆ used).
- **Capabilities are not first-class values.** They cannot be passed as function arguments, stored in records, etc. They exist only as types and as names available in handlers via `given`.
- **One provider per capability per context in v0.5.** No composition, no decoration. v0.6+ adds wrapper providers.
- **Agent state is a record, not a sum.** State-machine-style state (where state varies between e.g., `Pending` / `Placed` / `Cancelled` with different fields per variant) is a v0.6+ feature. v0.5 has flat record state with a status field if needed.
- **`commit` statement is the only state-update mechanism.** No `self.state.field = ...` mutation. No multiple-commit (single-shot per execution path).
- **Handler return shape is `Effect[Result[T, E]]`.** Plain `Effect[T]` is allowed for handlers that always succeed (rare).
- **Record spread is shallow.** No deep merge. Nested records must be explicitly spread per level.

### 9.2 Open questions worth pondering

These are not pinned down in v0.5 and may need attention in v0.5.1 or v0.6:

- **Agent reference syntax.** v0.5 uses `Order(id)` to denote an agent reference. Alternatives include `Order.ref(id)` (more verbose, more explicit) or special syntax. The current choice mirrors common actor-system patterns.
- **Service registration.** How are service operations exposed at deployment time? v0.5 emits TypeScript modules; a separate composition root file (perhaps generated) wires services to runtime endpoints. Deferred to v0.6 alongside cross-context call infrastructure.
- **Capability resolution algorithm.** When a handler declares `given Logger`, how does the runtime find the Logger provider? v0.5 assumes a per-context provider; v0.6 will need cross-context provider lookup.
- **Async error handling.** What happens if `<-` is used on an Effect that rejects (throws in TS terms)? v0.5's lowering uses `await`, so the rejection bubbles up — but this isn't Karn-visible. The model would be cleaner if Effect[T] could express both "succeeds with T" and "fails with E" via a separate kind of error type, but that's a substantial type-system change. Deferred.

---

## 10. v0.6 preview

What's coming after v0.5:

**Cross-context wiring.**

1. **Cross-context service calls.** A handler in one context invokes services in another, declared via the v0.4 `consumes` clause. Syntax: `Payments.authorise(amount)` where `Payments` is the consumed context's service surface.
2. **Type-identity enforcement at the checker.** The deferred-from-v0.4 work: when crossing the boundary, `commerce.orders.Money` doesn't pass nominally to `commerce.payment.Money` even though they're structurally identical.
3. **Wire-format infrastructure.** Serialisation/deserialisation between contexts. Each value crossing the boundary gets converted to a structural shape and re-constructed in the receiving context.
4. **Cross-context capability resolution.** A capability declared in one context can be provided by another. The DI graph spans contexts.
5. **Test contexts targeting contexts.** The third declaration kind — `test commerce.orders` — with mocking machinery for capabilities and consumed contexts.

After v0.6, the language is fully integrated as a service-tier application language. Multiple contexts can compose into a working system, with all the architectural commitments (encapsulation, boundary type identity, capability injection, transactional handlers) enforced at compile time.

v0.7+ will add:
- HTTP, queue, and cron handler kinds beyond `on call`.
- Provider composition (wrappers, decorators).
- Saga / compensation machinery.
- State machines (agent state as sum type).
- Idempotency tooling.
- Standard library expansion.

After v0.7, Karn is broadly complete. The remaining work is polish, ecosystem, and tooling.
