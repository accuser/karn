# Karn v0.9 Grammar — HTTP Handlers

A delta specification introducing the `on http` handler kind: external-facing HTTP routes that let Karn services receive requests from outside the system. This is the gating capability for building a real web application in Karn — until now, services could only be invoked by other Karn contexts (`on call`) or, in workers mode, via internal Service Bindings. After v0.9, a service can expose HTTP endpoints to the outside world.

Read all earlier specs first — `karn-mvp-grammar.md` through `karn-mvp-grammar-v0.8.md`, plus `karn-runtime-spec.md`. The v0.9 compiler accepts every v0–v0.8 program unchanged. All v0–v0.8 test fixtures must continue to pass.

`on queue` and `on cron` handlers are deferred to v0.10. v0.9 is HTTP alone — the most important external-facing capability and the one on the critical path to a useful application.

After v0.9, a Karn project can serve HTTP traffic. v0.10 adds background processing (queues, cron). Subsequent increments add state machines, provider composition, refinement narrowing, sagas.

---

## 1. Scope

### In scope for v0.9

- **The `on http` handler kind** — `on http POST "/path" (...) -> Effect[HttpResult[T]] { ... }`.
- **HTTP method routing** — GET, POST, PUT, PATCH, DELETE.
- **Path pattern matching with parameters** — `"/orders/:id"` with `:id` bound to a typed handler parameter.
- **Typed request bodies** — a parameter named `body` is deserialised from the request body using v0.8's wire-format machinery.
- **The `HttpResult[T]` built-in type** — a sum type covering common HTTP outcomes (200, 201, 400, 404, etc.), serialised to status code + body by the framework.
- **Worker fetch-handler aggregation** — all `on http` handlers across all services in a context aggregate into the Worker's `fetch` handler, alongside v0.8's internal Service Binding dispatch.
- **Internal/external path disambiguation** — internal Service Binding calls move to a reserved `/_karn/call/` prefix so external routes can use any path.

### Out of scope for v0.9 (deferred)

- **`on queue` and `on cron` handlers** — v0.10.
- **Query parameters** — `?key=value`. v0.10 or later. v0.9 handles path params and body only.
- **Custom HTTP status codes** beyond the `HttpResult` variants. The fixed vocabulary covers the common cases; arbitrary codes come later.
- **Request headers as typed inputs** — handlers don't yet receive headers as parameters. (The framework reads content-type for body parsing, but the handler doesn't see headers.)
- **Response headers** beyond content-type — handlers return `HttpResult`, which the framework serialises with `content-type: application/json`. Custom response headers come later.
- **Middleware / filters** — no cross-cutting request processing layer. Each handler is independent.
- **Content negotiation** — JSON only for v0.9.
- **Streaming responses** — handlers return a complete `HttpResult`; no streaming.
- **File uploads / multipart** — JSON bodies only.
- **WebSockets.**
- **Intra-service handler calls** — a handler cannot call another handler in the same service directly; shared logic goes in free functions.
- **Authentication / authorisation primitives** — these are application concerns, handled in handler bodies via capabilities, not language features.

---

## 2. Updated lexical structure

### New reserved keywords

```
http
```

`http` is the handler-kind keyword in `on http ...`. The HTTP method names (GET, POST, PUT, PATCH, DELETE) are contextual — recognised only in the `on http` position, usable as identifiers elsewhere.

The `HttpResult` type name is a built-in (like `Result`, `Option`, `Effect`); not a reserved keyword, but predeclared.

All other lexical rules are unchanged from v0.8.

---

## 3. Updated grammar

### 3.1 The `on http` handler

```
handler-block ::= doc-block? 'on' handler-kind handler-spec given-clause? block

handler-kind  ::= 'call'                              -- v0.5
                | 'http' http-method string-literal   -- NEW v0.9

http-method   ::= 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

handler-spec  ::= '(' param-list? ')' return-spec?
```

An `on http` handler declares a method, a path pattern, parameters, and a return type. The handler lives inside a `service` declaration alongside `on call` handlers.

**The service handler model.** A service is a named grouping of handlers. Its handlers are distinguished as follows:
- At most one `on call` handler — the cross-context RPC entry point. It has no method name of its own; the *service name* is the operation name (so `service authorise { on call(...) }` is invoked as `authorise` across contexts). This is the v0.5 model, unchanged.
- Any number of `on http` handlers — distinguished from each other by method + path.

Note the asymmetry with agents: an *agent* has multiple named handlers (`on call place(...)`, `on call cancel(...)`) because an agent is a stateful entity with several operations. A *service* `on call` handler has no name because the service itself names the single RPC operation. Putting a method name on a service's `on call` handler is a syntax error; the name belongs on agent handlers only.

Example:

```karn
service orders {
  on http POST "/orders" (body: CreateOrderRequest) -> Effect[HttpResult[OrderView]] 
      given Inventory {
    -- handler body
  }
  
  on http GET "/orders/:id" (id: OrderId) -> Effect[HttpResult[OrderView]] {
    -- handler body
  }
}
```

### 3.2 Path patterns and parameter binding

A path pattern is a string literal with optional `:name` segments denoting path parameters:

```
"/orders"                  -- no params
"/orders/:id"              -- one param: id
"/users/:userId/orders/:orderId"   -- two params
```

Parameter binding rules:

- A handler parameter whose name **matches a path segment** `:name` is bound from that path segment. Its type must be a type constructible from a string (a refined `String`, an opaque `String`, or `String` itself). The framework extracts the segment, attempts construction, and on failure returns 400.
- A handler parameter named **`body`** is bound from the request body. The body is deserialised (JSON) to the parameter's type using v0.8's wire-format deserialisation. On failure (malformed JSON, structural mismatch, refinement violation), the framework returns 400.
- For GET and DELETE, a `body` parameter is not permitted (these methods conventionally have no body).
- For POST, PUT, PATCH, a `body` parameter is typical but not required.
- Every handler parameter must be either a path parameter (name matches a path segment) or the `body` parameter. A parameter that's neither is a compile error.
- Every path segment `:name` must have a corresponding handler parameter. An unbound path segment is a compile error.

Examples:

```karn
on http GET "/orders/:id" (id: OrderId) -> Effect[HttpResult[OrderView]] { ... }
-- id bound from path; type OrderId must be constructible from String

on http POST "/orders" (body: CreateOrderRequest) -> Effect[HttpResult[OrderView]] { ... }
-- body deserialised from request body

on http PUT "/orders/:id" (id: OrderId, body: UpdateOrderRequest) 
    -> Effect[HttpResult[OrderView]] { ... }
-- id from path, body from request body
```

### 3.3 The `HttpResult[T]` type

`HttpResult[T]` is a built-in generic sum type (predeclared, like `Result`, `Option`, `Effect`):

```
type HttpResult[T] =
  | Ok(value: T)                          -- 200 OK
  | Created(value: T)                     -- 201 Created
  | NoContent                             -- 204 No Content
  | BadRequest(message: String)           -- 400 Bad Request
  | Unauthorized                          -- 401 Unauthorized
  | Forbidden                             -- 403 Forbidden
  | NotFound                              -- 404 Not Found
  | Conflict(message: String)             -- 409 Conflict
  | UnprocessableEntity(message: String)  -- 422 Unprocessable Entity
  | ServerError(message: String)          -- 500 Internal Server Error
```

An HTTP handler returns `Effect[HttpResult[T]]`. The framework serialises the result:
- The variant determines the HTTP status code.
- For `Ok(value)` and `Created(value)`: the body is the JSON-serialised `value`.
- For `NoContent`: no body.
- For error variants with a message: the body is a JSON object `{"error": "<message>"}`.
- For `Unauthorized`, `Forbidden`, `NotFound`: no body (status only).

The variant names are predeclared and usable directly in handler bodies (like `Ok`/`Err`/`Some`/`None`).

### 3.4 Handler body semantics

An HTTP handler body is an effectful block (returns `Effect[HttpResult[T]]`). Inside:
- All v0.5+ effectful rules apply (`<-`, `?`, capability calls, etc.).
- v0.7.1 auto-lift applies — a tail expression of type `HttpResult[T]` is auto-lifted to `Effect[HttpResult[T]]`.
- The `?` operator on a `Result` propagates the `Err` — but in an HTTP handler, propagating a domain `Err` directly would produce a type mismatch (the handler returns `HttpResult`, not `Result`). The handler must explicitly map domain errors to `HttpResult` variants (the Anti-Corruption Layer pattern at the HTTP boundary).

Example demonstrating the ACL pattern:

```karn
on http POST "/orders" (body: CreateOrderRequest) -> Effect[HttpResult[OrderView]] 
    given Inventory {
  -- construct the domain value; refinements may fail
  let amount = Money { minorUnits: body.amountMinor, currency: body.currency }
  let result <- createOrder(amount)
  match result {
    Ok(order) => Created(OrderView.from(order))
    Err(orderError) => match orderError {
      EmptyCart       => BadRequest("cart is empty")
      OutOfStock      => Conflict("item out of stock")
      PaymentDeclined => UnprocessableEntity("payment declined")
    }
  }
}
```

The handler explicitly maps every domain outcome to an HTTP outcome. There's no automatic mapping — the visible mapping is the point. A reader sees exactly which domain error becomes which HTTP status.

Note the nested `match` on `orderError`: Karn's pattern matcher matches one constructor level per arm, so sibling arms `Err(EmptyCart)` and `Err(OutOfStock)` are not permitted (both count as the `Err` arm, which reads as a duplicate). To discriminate the inner variant, match `Err(e)` and then `match e { ... }`. This is a consistent limitation since v0.6; nested constructor patterns (`Err(EmptyCart)` directly) are a candidate for a future increment.

### 3.5 Updated grammar — summary

```
handler-block ::= doc-block? 'on' handler-kind handler-spec given-clause? block

handler-kind  ::= 'call'
                | 'http' http-method string-literal

http-method   ::= 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
```

No other grammar changes. `HttpResult` is a predeclared type; its variants are predeclared constructors.

---

## 4. Updated static semantics

### 4.1 HTTP handler validation

For an `on http METHOD "path" (params) -> Effect[HttpResult[T]] given Caps { body }`:

1. The method is one of GET, POST, PUT, PATCH, DELETE.
2. The path pattern is well-formed (starts with `/`, segments are either literal or `:name`).
3. The path must not start with the reserved prefix `/_karn/` (used for internal Service Binding dispatch).
4. Every `:name` segment has a corresponding handler parameter named `name`.
5. Every handler parameter is either a path parameter (name matches a segment) or named `body`.
6. Path parameter types are constructible from `String` (refined String, opaque String, or String).
7. For GET and DELETE, no `body` parameter is permitted.
8. The return type is `Effect[HttpResult[T]]` for some `T`.
9. The `given` clause is verified as for any handler (used ⊆ declared, declared ⊆ used).

### 4.2 Route uniqueness

Within a context, no two HTTP handlers may have the same method + path pattern. Two handlers both declaring `GET "/orders/:id"` is a compile error (`karn.http.duplicate_route`). Patterns that overlap but aren't identical (e.g., `GET "/orders/:id"` and `GET "/orders/recent"`) are permitted; the router resolves them with literal segments taking priority over parameter segments.

### 4.3 HttpResult type checking

`HttpResult[T]` follows the same typing rules as other built-in sums:
- The variants are constructors: `Ok(value)`, `Created(value)`, `BadRequest(message)`, etc.
- `Ok` and `Created` require a `T` payload; the error variants with messages require a `String`; `NoContent`, `Unauthorized`, `Forbidden`, `NotFound` take no payload.
- Pattern matching on `HttpResult[T]` follows the standard exhaustiveness rules.

Note that `Ok` is now overloaded between `Result.Ok` and `HttpResult.Ok`. The expected-type disambiguation (from the v0.6 amendment discussion) applies: in a position expecting `HttpResult[T]`, `Ok(x)` resolves to `HttpResult.Ok`; in a position expecting `Result[T, E]`, it resolves to `Result.Ok`. Where the expected type is ambiguous, qualified construction (`HttpResult.Ok(x)`) is required.

### 4.4 Cross-context calls don't reach HTTP handlers

`on http` handlers are external-facing only. A cross-context `on call` (from v0.6) cannot invoke an `on http` handler — the two handler kinds are distinct. A context consuming another context calls its `on call` services, never its HTTP routes. HTTP routes are for external clients (browsers, mobile apps, other systems outside the Karn project).

---

## 5. Compilation to TypeScript

### 5.1 Worker fetch-handler aggregation

In workers mode (v0.8), each context's Worker has a `fetch` handler. Before v0.9, it only dispatched internal Service Binding calls. v0.9 extends it to also serve external HTTP routes.

The dispatch order in the generated `fetch` handler:

1. If the request path starts with `/_karn/call/`, it's an internal Service Binding call (v0.8 protocol). Dispatch to the named `on call` handler.
2. Otherwise, match the request method + path against the registered `on http` routes. If a route matches, extract path params, deserialise the body (if applicable), invoke the handler, serialise the `HttpResult`.
3. If no route matches, return 404.

### 5.2 Internal protocol prefix change

v0.8's internal Service Binding calls used `http://internal/<serviceName>`. v0.9 changes this to `http://internal/_karn/call/<serviceName>` so that external routes can use any path without colliding with internal dispatch.

This is a small change to v0.8's emission, folded into v0.9. Both the `callService` runtime helper (which constructs the internal request URL) and the Worker fetch handler (which routes it) update to use the prefix.

### 5.3 The generated router

The Worker's `fetch` handler contains a router generated from the context's `on http` handlers:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    
    // Internal Service Binding dispatch
    if (path.startsWith("/_karn/call/")) {
      return handleInternalCall(request, env, path);
    }
    
    // External HTTP routes
    const surface = compose(env);
    
    // GET /orders/:id
    {
      const match = matchPath("/orders/:id", path);
      if (method === "GET" && match) {
        return handleGetOrder(match.params, surface);
      }
    }
    
    // POST /orders
    {
      if (method === "POST" && path === "/orders") {
        return handlePostOrders(request, surface);
      }
    }
    
    return new Response("Not Found", { status: 404 });
  },
};
```

Each route gets a generated handler function that:
1. Extracts and constructs path parameters (returning 400 if construction fails).
2. Deserialises the body if present (returning 400 if deserialisation fails).
3. Invokes the Karn handler.
4. Serialises the `HttpResult` to a `Response`.

### 5.4 Path matching

The framework needs a path matcher. The runtime gains a `matchPath(pattern, path)` helper:

```typescript
export function matchPath(
  pattern: string,
  path: string
): { params: Record<string, string> } | null {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = path.split("/").filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return null;
  
  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const p = patternSegments[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(pathSegments[i]);
    } else if (p !== pathSegments[i]) {
      return null;
    }
  }
  return { params };
}
```

Literal segments must match exactly; `:name` segments capture the path value. Routes with all-literal segments should be checked before routes with parameters (the router generation orders them so).

### 5.5 HttpResult serialisation

The runtime gains a helper to serialise `HttpResult[T]` to a `Response`:

```typescript
export function httpResultToResponse<T>(
  result: HttpResult<T>,
  serialiseValue: (v: T) => JsonValue
): Response {
  switch (result.kind) {
    case "Ok":
      return new Response(JSON.stringify(serialiseValue(result.value)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    case "Created":
      return new Response(JSON.stringify(serialiseValue(result.value)), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    case "NoContent":
      return new Response(null, { status: 204 });
    case "BadRequest":
      return new Response(JSON.stringify({ error: result.message }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    case "Unauthorized":
      return new Response(null, { status: 401 });
    case "Forbidden":
      return new Response(null, { status: 403 });
    case "NotFound":
      return new Response(null, { status: 404 });
    case "Conflict":
      return new Response(JSON.stringify({ error: result.message }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    case "UnprocessableEntity":
      return new Response(JSON.stringify({ error: result.message }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    case "ServerError":
      return new Response(JSON.stringify({ error: result.message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
  }
}
```

The `serialiseValue` is the per-instantiation serialiser for `T` (v0.8 machinery).

### 5.6 The HttpResult type in the runtime

The runtime gains the `HttpResult<T>` type definition and its constructors:

```typescript
export type HttpResult<T> =
  | { readonly kind: "Ok"; readonly value: T }
  | { readonly kind: "Created"; readonly value: T }
  | { readonly kind: "NoContent" }
  | { readonly kind: "BadRequest"; readonly message: string }
  | { readonly kind: "Unauthorized" }
  | { readonly kind: "Forbidden" }
  | { readonly kind: "NotFound" }
  | { readonly kind: "Conflict"; readonly message: string }
  | { readonly kind: "UnprocessableEntity"; readonly message: string }
  | { readonly kind: "ServerError"; readonly message: string };

// Constructors emitted per the standard pattern.
```

Note the `Ok` / `Created` constructors here are distinct from `Result.Ok`. The emitter qualifies them appropriately based on the Karn expected-type resolution.

### 5.7 Bundle mode and HTTP

In bundle mode (single deployment unit), HTTP handlers compile into the per-context `handlers.ts` and `compose.ts` so they exist on the surface — but **generating a top-level bundle `fetch` entry point that aggregates all contexts' HTTP routes is deferred**. As implemented, bundle mode produces the handler implementations but not a single fetch handler wired to serve them.

The practical consequence: bundle mode is for tests and development (where handlers are invoked directly, not over HTTP); HTTP *serving* uses workers mode. For a single-context application that wants to serve HTTP, workers mode produces exactly one Worker with the HTTP routes wired — which is the right deployment artefact regardless. Bundle-mode HTTP serving (a single Node-runnable process serving all routes, useful for local development without wrangler/miniflare) is a reasonable future addition but not on the critical path: every deployment scenario is covered by workers mode.

If bundle-mode HTTP serving is later wanted (primarily for local dev ergonomics), the work is bounded: generate a top-level `fetch` handler in the bundle output that aggregates every context's routes into one router, reusing the per-context router generation.

---

## 6. New test corpus

### Positive fixtures (new for v0.9)

```
tests/positive/
├── 122_http_get_simple/                    -- on http GET with no params
├── 123_http_get_path_param/                -- on http GET "/orders/:id"
├── 124_http_post_body/                     -- on http POST with a body parameter
├── 125_http_put_path_and_body/             -- on http PUT with both
├── 126_http_result_variants/               -- handler returning various HttpResult variants
├── 127_http_acl_pattern/                   -- domain errors mapped to HTTP results
├── 128_http_and_call_same_service/         -- a service with both on call and on http
├── 129_full_orders_http_api/               -- worked example: orders context with an HTTP API
```

### Negative fixtures (new for v0.9)

```
tests/negative/
├── 95_http_unbound_path_param/             -- "/orders/:id" but no id parameter
├── 96_http_extra_param/                    -- a parameter that's neither path nor body
├── 97_http_get_with_body/                  -- on http GET with a body parameter
├── 98_http_duplicate_route/                -- two handlers with the same method+path
├── 99_http_reserved_prefix/                -- path starting with /_karn/
├── 100_http_path_param_not_stringy/        -- path param typed as a non-String-constructible type
```

### v0.9 worked example: orders HTTP API

Building on the v0.6/v0.8 orders↔payment integration, v0.9 adds an HTTP API to the orders context:

```karn
---
Orders context with an HTTP API.
---
context commerce.orders

uses commerce.money
uses commerce.identifiers
consumes commerce.payment as Payment

exports opaque      { Order }
exports transparent { OrderError }

type OrderError = enum {
  EmptyCart,
  PaymentDeclined,
  PaymentInfrastructureError,
}

---
The request payload for creating an order. A plain record deserialised
from the HTTP request body.
---
type CreateOrderRequest = {
  amountMinor: Int where NonNegative,
  currency:    CurrencyCode,
}

---
The view returned to HTTP clients. Doesn't expose internal Order structure.
---
type OrderView = {
  id:     String,
  status: String,
  total:  Int,
}

agent OrderEntity {
  key id: OrderId
  
  state {
    total:  Money,
    authId: Option[AuthId],
    placed: Bool,
  }
  
  on call place(total: Money) -> Effect[Result[Order, OrderError]] {
    let auth <- Payment.authorise(total)
    match auth {
      Ok(authId) => {
        commit { total: total, authId: Some(authId), placed: true }
        Ok(Order { id: self.id, total: total, authId: authId })
      }
      Err(paymentError) => match paymentError {
        Declined          => Err(PaymentDeclined)
        InsufficientFunds => Err(PaymentDeclined)
        GatewayDown       => Err(PaymentInfrastructureError)
      }
    }
  }
}

service orders {
  ---
  Create an order via HTTP. Parses the request, places the order through
  the agent, and maps the domain outcome to an HTTP result.
  ---
  on http POST "/orders" (body: CreateOrderRequest) -> Effect[HttpResult[OrderView]] {
    -- Construct Money directly from the request fields. The constructor
    -- returns Result because the refinements (NonNegative on minorUnits,
    -- the currency code format) can fail.
    let amount = Money { minorUnits: body.amountMinor, currency: body.currency }
    
    let order = OrderEntity(OrderId.generate())
    let result <- order.place(amount)
    
    match result {
      Ok(o) => Created(OrderView {
        id:     o.id.unwrap(),
        status: "placed",
        total:  amount.minorUnits,
      })
      Err(orderError) => match orderError {
        EmptyCart                  => BadRequest("cart is empty")
        PaymentDeclined            => UnprocessableEntity("payment declined")
        PaymentInfrastructureError => ServerError("payment system unavailable")
      }
    }
  }
}
```

This exercises:
- An `on http POST` handler with a typed body.
- The `HttpResult` type with multiple variants (`Created`, `BadRequest`, `UnprocessableEntity`, `ServerError`).
- The Anti-Corruption Layer pattern at the HTTP boundary — domain `OrderError` variants mapped explicitly to HTTP outcomes.
- A cross-context call (`Payment.authorise`) inside an HTTP request flow.
- Body deserialisation and view serialisation.

When deployed (workers mode), POST requests to `/orders` hit this handler. The orders Worker calls the payment Worker via Service Binding for authorisation. The response is a 201 with the OrderView, or an appropriate error status.

---

## 7. Implementation notes

### 7.1 Backwards compatibility

All v0–v0.8 fixtures pass. The grammar addition is additive (the `on http` handler kind). The internal-protocol prefix change (§5.2) is internal to the emission and doesn't affect Karn source.

### 7.2 Where new code goes

- `lexer.rs`: `http` keyword; HTTP method names as contextual keywords.
- `ast.rs`: `HandlerKind::Http { method, path }`; `HttpResult` as a predeclared type.
- `parser.rs`: parse `on http METHOD "path" (...)`.
- `resolver.rs`: bind path parameters to handler parameters; resolve `HttpResult` and its variants.
- `checker.rs`:
  - Validate HTTP handlers (§4.1).
  - Route uniqueness (§4.2).
  - HttpResult type checking with Ok/Created disambiguation against Result.Ok.
  - Path parameter type constructibility-from-String check.
- `emitter.rs`:
  - Generate the router in the Worker fetch handler.
  - Per-route handler functions (param extraction, body deserialisation, invocation, response serialisation).
  - The internal-protocol prefix change.
- `runtime_emission.rs`:
  - `HttpResult<T>` type and constructors.
  - `matchPath(...)` helper.
  - `httpResultToResponse(...)` helper.

### 7.3 Risk areas

- **Ok/Created overloading with Result.Ok.** The expected-type disambiguation is essential here. In an HTTP handler returning `HttpResult[T]`, a tail `Ok(x)` must resolve to `HttpResult.Ok`, not `Result.Ok`. The checker's expected-type propagation (extended in v0.7.1) drives this. Where genuinely ambiguous, require qualified construction. Test thoroughly — this is the most likely source of confusing errors.

- **Path parameter construction.** A path param typed as `OrderId` (opaque String) must be constructed from the raw path segment, which can fail (refinement violation). The framework returns 400 on failure. Make sure the generated param-extraction code handles this.

- **Route ordering.** Literal routes must be matched before parameter routes (`GET "/orders/recent"` before `GET "/orders/:id"`). The router generation orders them. Get this right or `/orders/recent` will be captured as `:id == "recent"`.

- **Body deserialisation reuse.** The v0.8 wire-format deserialisation machinery handles request bodies. Make sure the HTTP path reuses it rather than reimplementing.

- **The Ok/Created disambiguation in emission.** The emitter must generate `HttpResult.Ok` (the right constructor) vs `Result.Ok` based on the resolved type. Don't conflate them in emission.

### 7.4 What "done" looks like

1. All v0–v0.8 fixtures pass (regression).
2. All v0.9 fixtures pass (8 positive, 6 negative).
3. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean.
4. The orders HTTP API worked example compiles in both bundle and workers mode.
5. The emitted Worker fetch handler correctly routes external HTTP requests and internal Service Binding calls.
6. The generated TypeScript compiles cleanly under `tsc --strict`.
7. Path parameter extraction, body deserialisation, and HttpResult serialisation all work correctly.
8. The Ok/Created vs Result.Ok disambiguation produces clear errors when ambiguous.

A manual smoke test (not automated): deploy the orders worked example and make an actual `curl -X POST .../orders -d '{"amountMinor": 5000, "currency": "USD"}'` request, verifying a 201 response.

---

## 8. v0.10 preview

What's coming after v0.9:

**Background processing — `on queue` and `on cron`.**

- `on queue("queue-name") (message: MessageType) -> Effect[Result[(), ProcessError]] { ... }` — queue consumers. The handler processes one message; returning `Ok` acknowledges it, returning `Err` triggers a retry (per Cloudflare Queue semantics). The framework manages batches.
- `on cron("0 0 * * *") () -> Effect[Result[(), TaskError]] { ... }` — scheduled tasks. The cron expression maps to a wrangler.toml `[triggers]` entry. The handler runs on schedule.

These reuse the wire-format machinery (for message deserialisation) and aggregate into the Worker's `queue` and `scheduled` handlers respectively.

**Subsequent increments:**
- v0.11: State machines as sums.
- v0.12: Provider composition.
- v0.13: Refinement narrowing.
- v0.14: Sagas / compensation.
- v0.15: Cross-context capability resolution.
- v0.16: Multi-Worker integration testing.

After v0.10, Karn handles the full inbound surface of a Workers application: HTTP, queues, cron, plus internal cross-context calls. The remaining increments refine the type system and add production patterns.
