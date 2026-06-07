# Karn v0.8 Grammar — Multi-Worker Deployment

A delta specification introducing multi-Worker deployment: each context compiles to its own Cloudflare Worker, cross-context calls become real network calls via Service Bindings, and the wire format becomes a runtime concern (JSON serialisation/deserialisation with refinement validation at the receiving side). Read all earlier specs first — `karn-mvp-grammar.md` through `karn-mvp-grammar-v0.7.1.md`, plus `karn-runtime-spec.md`.

The v0.8 compiler accepts every v0–v0.7.1 program unchanged. The Karn *language surface* doesn't change in v0.8 — no new keywords, no new grammar, no new declaration forms. The compiler gains a new build target (`--target=workers`); cross-context calls compile differently under that target. After v0.8, Karn projects can deploy as production-grade multi-Worker systems on Cloudflare.

All v0–v0.7.1 test fixtures must continue to pass. v0.7.1's worked examples continue to compile and run under `--target=bundle` (the default, existing behaviour). New v0.8 fixtures verify the workers target.

**Important architectural note:** v0.8 implements the *runtime* counterpart of v0.6's compile-time structural projection. v0.6 established that two contexts' rebranded versions of the same commons type are nominally distinct but structurally compatible. In bundle mode, this is enforced at compile time only; in workers mode, it becomes a real boundary with serialisation, deserialisation, and validation. The user-facing Karn code is identical between modes; only the lowered TypeScript differs.

---

## 1. Scope

### In scope for v0.8

- **Build target selection** — `karnc build --target=workers` produces per-context Worker bundles; `karnc build --target=bundle` (default) produces the existing single-bundle output.
- **Per-context Worker generation** — one Worker per context, each with its own entry point, its own runtime instance, its own composition root.
- **Service Binding-based cross-context calls** — `commerce.orders.placeOrder` calling `commerce.payment.authorise` becomes a real Service Binding invocation between the two Workers.
- **JSON wire format** — values crossing context boundaries serialise to JSON and deserialise on the receiving side, with refinement validation applied during deserialisation.
- **Boundary error propagation** — when deserialisation or validation fails on the receiving side, the failure propagates back through Effect (as a Promise rejection at the TypeScript level). v0.8 does not introduce explicit boundary error capture syntax; that's deferred.
- **`wrangler.toml` generation** — one config file per context Worker, with Service Bindings declared for consumed contexts.
- **Updated runtime module** — adds serialisation, deserialisation, validation, and cross-context call helpers used in workers mode.
- **Backward-compatible bundle mode** — single-bundle compilation (the existing default) is unchanged.

### Out of scope for v0.8 (deferred to v0.9+)

- **Explicit boundary error capture syntax.** Boundary failures propagate as Effect rejections in v0.8; v0.9+ can add capture machinery if practice surfaces the need.
- **Additional handler kinds** (`on http`, `on queue`, `on cron`). v0.8 keeps `on call` as the only kind; HTTP routing for external consumers is a v0.9 concern. The cross-context Service Binding calls are infrastructure, not user-facing HTTP.
- **Provider composition.** Wrappers, decorators. Deferred to v0.9 or v0.10.
- **State machines as sum types.** Agent state as a sum. Deferred.
- **Cross-context capability resolution.** Capabilities stay strictly intra-context.
- **Sagas / compensation machinery.** Multi-context coordination with rollback semantics.
- **Refinement narrowing.** The conservative "exact match" rule from v0.6 stays.
- **Multi-Worker integration testing.** `karnc test` continues to use bundle mode for tests; testing actual Service Binding behaviour requires miniflare or wrangler dev, deferred.
- **Worker grouping** (deploying multiple contexts as one Worker for efficiency). v0.8 is 1:1 contexts-to-Workers.
- **Custom URL paths or routing** for the inter-Worker protocol. Paths are derived deterministically from service names.
- **Production deployment automation.** v0.8 generates the wrangler.toml files; the user runs `wrangler deploy` themselves.
- **Observability hooks** (tracing, logging, metrics). Deferred.

---

## 2. Build modes

### 2.1 Two targets

`karnc build` and `karnc test` both accept a `--target` flag:

- `--target=bundle` (default) — single deployment unit; cross-context calls are direct function calls (v0.6+ behaviour, unchanged).
- `--target=workers` — multi-Worker; cross-context calls are Service Binding invocations.

`karnc test` always uses `bundle` regardless of the flag — testing remains in-process. Future increments may add multi-Worker integration testing.

### 2.2 The bundle target (existing, summary)

- Output: `out/runtime.ts`, `out/compose.ts`, per-context modules in `out/<context-path>/`.
- All contexts compile into one TypeScript bundle, then to one JavaScript output (or run via tsx/ts-node).
- Cross-context calls compile to `await deps.surface.<context>.<service>(args)` — direct function invocation with the brand-restamping cast.

This is v0.6+ behaviour, unchanged.

### 2.3 The workers target (new in v0.8)

- Output structure:
  ```
  out/
  ├── runtime.ts                          -- shared runtime (existing + v0.8 additions)
  ├── tsconfig.json
  └── workers/
      ├── commerce-payment/
      │   ├── index.ts                    -- Worker entry point
      │   ├── wrangler.toml               -- generated Cloudflare config
      │   ├── compose.ts                  -- per-Worker composition root
      │   └── handlers.ts                 -- service handler implementations
      ├── commerce-orders/
      │   ├── index.ts
      │   ├── wrangler.toml
      │   ├── compose.ts
      │   └── handlers.ts
      └── ...
  ```
- Each context becomes a directory under `out/workers/`. The directory name is the context's qualified name with `.` replaced by `-` (so `commerce.payment` → `commerce-payment`).
- Each Worker directory has its own entry point (`index.ts`), wrangler config (`wrangler.toml`), composition root (`compose.ts`), and service handlers (`handlers.ts`).
- The shared runtime (`out/runtime.ts`) is imported by each Worker via relative path.
- Cross-context calls compile to Service Binding invocations using the wire-format protocol (§3).

The user deploys with `wrangler deploy --config out/workers/commerce-payment/wrangler.toml` (and similar for each Worker). v0.8 doesn't automate deployment.

### 2.4 Configuration

For v0.8, no `karn.toml` additions are required. The `--target` flag is the only knob. A future increment may add `[build].default_target` to `karn.toml` for projects that consistently want workers mode.

---

## 3. The wire format

### 3.1 JSON serialisation

Cross-context values serialise to JSON. The mapping:

- **Primitive types:** `Int` → JSON number, `String` → JSON string, `Bool` → JSON boolean, `()` (unit) → JSON null.
- **Refined types:** the underlying primitive's JSON representation. The refinement constraints (`InRange`, `Matches`, etc.) are validated on the receiving side, not encoded in the JSON.
- **Records:** JSON object with keys matching field names and values recursively serialised.
- **Sum types:** JSON object with a `kind` discriminator and variant-specific payload. E.g., `Result.Ok(value)` → `{"kind": "Ok", "value": <serialised value>}`.
- **Option:** `Some(value)` → `{"kind": "Some", "value": <serialised>}`; `None` → `{"kind": "None"}`.
- **Opaque types:** serialise as the underlying representation. The opacity is a compile-time concept; the wire format sees through.

Generic types follow the obvious recursion: `Result[T, E]` serialises with `T`-serialised value or `E`-serialised error.

### 3.2 JSON deserialisation with validation

On the receiving side, deserialisation:

1. Parses the JSON string to a JavaScript value.
2. For each field of the expected type, validates the value matches the structural shape (right type, right shape).
3. For refined values, applies the refinement constraints (the validation already in v0.5's emitted constructors).
4. Constructs the receiving context's nominal type from the validated structural data.

Deserialisation can fail at three points:
- Malformed JSON (transport / serialisation error).
- Structural mismatch (e.g., missing field, wrong type).
- Refinement violation (the value's structure is correct but constraints are violated).

All three become `BoundaryError` results at the receiving Worker, which propagate back to the caller as Promise rejections (see §4).

### 3.3 The BoundaryError type

The runtime gains a new error type:

```typescript
export type BoundaryError =
  | { readonly kind: "MalformedJson"; readonly details: string }
  | { readonly kind: "StructuralMismatch"; readonly path: string; readonly expected: string; readonly actual: string }
  | { readonly kind: "RefinementViolation"; readonly path: string; readonly violation: ValidationError }
  | { readonly kind: "Transport"; readonly status: number; readonly details: string };
```

This is part of the runtime; not part of the Karn user-facing language. Users see boundary failures as Effect rejections (Promise rejections in TS terms).

### 3.4 Per-type serialisation/deserialisation

For each type that crosses context boundaries (used in a cross-context service call's argument or return position), the compiler emits two helpers:

```typescript
// In the OWNING context's module:
export function serialise_Money(value: Money): JsonValue {
  return { minorUnits: value.minorUnits, currency: value.currency };
}

export function deserialise_Money(json: JsonValue): Result<Money, BoundaryError> {
  if (typeof json !== "object" || json === null) {
    return Err({ kind: "StructuralMismatch", path: "$", expected: "object", actual: typeof json });
  }
  // ... validate each field, apply refinements ...
  return Ok({ minorUnits: ..., currency: ... } as Money);
}
```

The emitter generates these per type, on demand. Only types that actually cross boundaries get the helpers; intra-context-only types are emission unchanged.

---

## 4. Cross-context call lowering (workers target)

### 4.1 The compiled call shape

In bundle mode, `Payment.authorise(amount)` compiles to:

```typescript
await deps.surface.payment.authorise(amount as commerce_payment.Money)
```

In workers mode, the same Karn source compiles to:

```typescript
await callService(
  deps.env.COMMERCE_PAYMENT,
  "authorise",
  commerce_payment.serialise_Money(amount),
  commerce_payment.deserialise_Result_AuthId_PaymentError
)
```

Where:
- `deps.env.COMMERCE_PAYMENT` is the Service Binding to the commerce-payment Worker. The Worker's `env` (containing all Service Bindings and DO bindings) is threaded through the deps object — `deps.env` — matching the unified-injection pattern used elsewhere (capabilities, surfaces).
- `"authorise"` is the service operation name (becomes the URL path `/authorise`).
- `commerce_payment.serialise_Money(amount)` produces the JSON-serialisable shape via the consuming context's re-exported namespace.
- `commerce_payment.deserialise_Result_AuthId_PaymentError` is the per-instantiation specialised deserialiser for the return type.

The `callService` helper lives in the runtime (`out/runtime.ts`).

### 4.2 The callService runtime helper

```typescript
export async function callService<T, E>(
  binding: { fetch: (req: Request) => Promise<Response> },
  servicePath: string,
  argsJson: JsonValue,
  deserialiseResult: (json: JsonValue) => Result<Result<T, E>, BoundaryError>,
): Promise<Result<T, E>> {
  const request = new Request(`http://internal/${servicePath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(argsJson),
  });
  
  const response = await binding.fetch(request);
  
  if (!response.ok) {
    throw boundaryError({
      kind: "Transport",
      status: response.status,
      details: await response.text(),
    });
  }
  
  const responseJson = await response.json();
  const result = deserialiseResult(responseJson);
  
  if (isErr(result)) {
    throw boundaryError(result.error);
  }
  
  return result.value;
}
```

`boundaryError(...)` constructs an Error object that wraps a `BoundaryError`; throwing it causes the surrounding Promise (the Effect) to reject. Users see this as the Effect failing — they cannot catch it explicitly in v0.8.

The helper handles three failure modes:
- Transport failure (`response.ok` false): throws as a `Transport` boundary error.
- Deserialisation failure: throws as the underlying `BoundaryError` from `deserialiseResult`.
- Application error from the receiving service: returns as `Err(E)` — *not* a boundary error; this is the service's declared error.

### 4.3 The receiving side: Worker entry point

Each Worker's `index.ts` handles incoming Service Binding requests by dispatching on the URL path:

```typescript
import { compose } from "./compose";
import { handlers } from "./handlers";
import { deserialise_AuthorisePayload, serialise_AuthoriseResult } from "./handlers";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\//, "");
    
    const surface = compose(env);
    
    switch (path) {
      case "authorise": {
        const argsJson = await request.json();
        const args = deserialise_AuthorisePayload(argsJson);
        if (isErr(args)) {
          return new Response(JSON.stringify(args.error), { status: 400 });
        }
        try {
          const result = await surface.authorise(args.value);
          return new Response(JSON.stringify(serialise_AuthoriseResult(result)));
        } catch (e) {
          return new Response(String(e), { status: 500 });
        }
      }
      // ... other service operations ...
      default: {
        return new Response("Not found", { status: 404 });
      }
    }
  },
};
```

The structure:
- Parse the URL to get the service operation name.
- Deserialise the request body to the service's argument type, applying validation.
- If deserialisation fails (refinement violation, structural mismatch), return 400 with the error as JSON.
- Invoke the service handler with the validated args.
- Serialise the result and return it as 200.
- Handle uncaught errors as 500.

This is generated mechanically per Worker by the emitter.

### 4.4 Service Binding declarations in wrangler.toml

Each Worker's `wrangler.toml` declares Service Bindings for the contexts it consumes:

```toml
name = "commerce-orders"
main = "index.ts"
compatibility_date = "2024-01-01"

[[services]]
binding = "COMMERCE_PAYMENT"
service = "commerce-payment"
```

The binding name (`COMMERCE_PAYMENT`) is derived from the consumed context's qualified name (uppercase, dots become underscores). The service name (`commerce-payment`) matches the Worker's directory name (and the wrangler config of the consumed Worker).

The compiler generates these per Worker based on the project's consumes graph.

### 4.5 Agents (Durable Objects) in multi-Worker

Agents are intra-context (the architectural commitment from v0.5–v0.7). In workers mode:

- Each agent class lives in its owning context's Worker.
- The Worker's wrangler.toml declares the DO binding.
- Cross-context calls *don't* directly address agents — they go through services, which may internally invoke agents within their own Worker.

So a consumer of `commerce.orders.placeOrder` calls a service; that service handler runs in the orders Worker; inside, it can invoke `OrderEntity` (the agent) directly via the standard DO stub pattern. The consumer never sees the agent.

The wrangler.toml addition for a context with agents:

```toml
[[durable_objects.bindings]]
name = "ORDER_ENTITY"
class_name = "OrderEntity"

[migrations]
new_classes = ["OrderEntity"]
tag = "v1"
```

Generated by the compiler from the agent declarations.

---

## 5. Updated runtime module (`out/runtime.ts`)

The v0.8 runtime extends the v0.7 runtime spec (`karn-runtime-spec.md`):

### 5.1 Additions to runtime.ts

- The `BoundaryError` type (§3.3).
- The `JsonValue` type (`null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue }`).
- The `boundaryError(error: BoundaryError): Error` helper (constructs a throwable Error wrapping a BoundaryError).
- The `callService<T, E>(...)` helper (§4.2).
- A `ServiceBinding` interface matching Cloudflare's Service Binding shape:
  ```typescript
  export interface ServiceBinding {
    fetch(request: Request): Promise<Response>;
  }
  ```
- An `Env` type (per-Worker; mostly informational since each Worker has its own Env shape).

The existing runtime contents (Result, Option, Effect, ValidationError, in-memory DO state, test machinery) are unchanged.

### 5.2 Per-context serialisation helpers

Each context's compiled module gains serialisation/deserialisation helpers for every type that crosses a boundary. These are emitted on demand (only for types that are actually used in cross-context positions).

For instance, if commerce.payment exports `AuthId` and `PaymentError`, and a service `authorise(amount: Money)` returns `Effect[Result[AuthId, PaymentError]]`, the payment module gains:

```typescript
export function serialise_Money(value: Money): JsonValue { /* ... */ }
export function deserialise_Money(json: JsonValue): Result<Money, BoundaryError> { /* ... */ }
export function serialise_AuthId(value: AuthId): JsonValue { /* ... */ }
export function deserialise_AuthId(json: JsonValue): Result<AuthId, BoundaryError> { /* ... */ }
export function serialise_PaymentError(value: PaymentError): JsonValue { /* ... */ }
export function deserialise_PaymentError(json: JsonValue): Result<PaymentError, BoundaryError> { /* ... */ }
```

The emitter walks each service operation's signature, collects the types that cross boundaries, and emits the helpers for those types only. Transitively-referenced types (record fields, sum payloads, generic parameters) also get helpers.

**Generic types use per-instantiation specialised helpers.** `Result<T, E>` and `Option<T>` get fully-specialised helper functions per instantiation rather than runtime-generic-parameterised ones:

```typescript
export function serialise_Result_AuthId_PaymentError(
  value: Result<AuthId, PaymentError>
): JsonValue { /* ... */ }

export function deserialise_Result_AuthId_PaymentError(
  json: JsonValue
): Result<Result<AuthId, PaymentError>, BoundaryError> { /* ... */ }
```

Rather than a parameterised generic like `serialise_Result<T, E>(value, serialiseInner, serialiseError)` that accepts inner serialisers as parameters. The per-instantiation approach is preferred because:

- Each helper has a single, fully-typed signature that `tsc --strict` verifies straightforwardly.
- Production stack traces show specific helper names — `serialise_Result_AuthId_PaymentError` rather than a generic helper called with mystery callbacks. Debugging is significantly easier.
- The generated code is more verbose, but generated code is read by debuggers and humans investigating issues, not by other code calling it. Verbosity is the right trade-off.

**Ownership and re-exports.** Boundary helpers live in the type's owning module. For commons-owned types that flow through multiple consuming contexts, each consuming context's emitted module re-exports the commons-owned helpers so that consumers address them through a single namespace.

A caller in commerce.orders that needs to serialise a Money for a call to commerce.payment writes `commerce_payment.serialise_Money(amount)` — even though Money is owned by commerce.money commons. The re-export through `commerce_payment.*` makes the consumer's import surface uniform: whatever cross-context call you're making, you reach into the consumed context's namespace and find every helper you need there.

---

## 6. New test corpus

### Positive fixtures (new for v0.8)

```
tests/positive/
├── 117_workers_target_simple/                  -- compile a single-context project to workers/
├── 118_workers_target_with_consume/            -- two contexts, one consumes the other,
│                                                  workers target emits both with Service Binding
├── 119_workers_emits_wrangler_toml/            -- check wrangler.toml structure
├── 120_workers_emits_serialisation/            -- check serialisation helpers emitted
│                                                  for types crossing boundaries
├── 121_workers_with_agent/                     -- a context with an agent emits DO bindings
│                                                  in wrangler.toml
```

### Negative fixtures (new for v0.8)

```
tests/negative/
├── 94_workers_with_cycle/                       -- workers target on a project with a
│                                                  consumes cycle (already invalid; verify
│                                                  the workers target also rejects it clearly)
```

The positive fixtures are compilation-and-structure tests (verify the right files are emitted with the right shapes). They don't require Worker execution — that's tested through the actual deployment workflow, which is out of scope for compiler tests.

### v0.8 worked example

Building on v0.6's orders↔payment integration, v0.8 emits it under workers mode:

`karnc build --target=workers` on the orders↔payment project produces:

```
out/workers/
├── commerce-payment/
│   ├── index.ts             -- routes /authorise, /refund to handlers
│   ├── handlers.ts          -- the service handler implementations
│   ├── compose.ts           -- assembles Payment's deps
│   └── wrangler.toml        -- declares the Worker
└── commerce-orders/
    ├── index.ts             -- routes /placeOrder to handler
    ├── handlers.ts          -- the service handler; calls Payment.authorise via Service Binding
    ├── compose.ts           -- assembles Orders' deps
    └── wrangler.toml        -- declares Worker + Service Binding to commerce-payment
                                  + DO binding for OrderEntity
```

The user can then `cd out/workers/commerce-payment && wrangler deploy` and similarly for commerce-orders, getting two deployed Workers communicating via Service Bindings.

For testing this worked example structurally (no actual deployment), verify:

1. The four files exist in each Worker directory.
2. The wrangler.toml for commerce-orders declares the COMMERCE_PAYMENT service binding.
3. The wrangler.toml for commerce-payment declares no service bindings (it's a leaf).
4. The wrangler.toml for commerce-orders declares the OrderEntity DO binding.
5. commerce-orders/handlers.ts contains a `callService(deps.env.COMMERCE_PAYMENT, "authorise", ...)` invocation.
6. commerce-payment/handlers.ts contains the actual authorise logic.
7. Both Workers' index.ts handle the expected URL paths.

---

## 7. Implementation notes

### 7.1 Backwards compatibility

All v0–v0.7.1 fixtures pass under `--target=bundle` (the default). The workers target is purely additive — it changes nothing about bundle mode emission.

### 7.2 Where new code goes

- `karnc/src/cli.rs` — add `--target` flag to `build` subcommand.
- `karnc/src/emitter.rs` — add a `workers` emission path. Major addition: per-context Worker directory generation, wrangler.toml generation, service binding lowering, serialisation helper generation.
- `karnc/src/emitter/serialisation.rs` — new module: per-type serialise/deserialise helper generation.
- `karnc/src/emitter/wrangler.rs` — new module: wrangler.toml generation.
- `karnc/src/emitter/workers_entry.rs` — new module: per-Worker `index.ts` generation.
- `karnc/src/runtime_emission.rs` (or wherever the runtime spec content lives) — add the v0.8 runtime additions.

The bundle-mode emitter stays unchanged. The workers-mode emitter is a parallel implementation that may share helpers (e.g., for the basic per-context module structure) but produces a different output tree.

### 7.3 Risk areas

- **Service Binding shape compatibility.** The Service Binding API in Cloudflare Workers has a specific shape. Verify against the current Cloudflare docs. The `binding.fetch(request)` pattern is well-established; less-common patterns may have changed recently.

- **wrangler.toml format compatibility.** The wrangler config format evolves. Generate for the current schema and pin a `compatibility_date`. Document the wrangler version this targets.

- **Serialisation completeness.** Every type that crosses a boundary needs both serialise and deserialise helpers. Walk the project's consumes graph and collect every type used in cross-context positions. Don't miss transitively-referenced types (record fields, sum payloads, generic parameters).

- **Refinement validation in deserialisation.** Deserialising a refined value isn't just structural — the refinement constraints must be re-validated. The receiving side cannot trust the sending side to have validated correctly (different context versions may have different refinements). Re-validate.

- **Boundary error propagation.** When the receiving Worker returns 400 (validation failure) or 500 (uncaught error), the calling Worker's `callService` throws. The throw propagates up the async chain to the caller's service handler, where it... probably becomes a 500 in the caller's Worker too. This cascades. For v0.8, that's acceptable — it's correct behaviour, just not pretty. Future work can refine.

- **Per-Worker tsconfig and dependencies.** Each Worker is its own deployment artefact. The tsconfig for workers mode is the same shared one (or per-Worker overrides). Dependencies (the runtime, the shared types from commons) are imported via relative paths.

### 7.4 What "done" looks like

1. All v0–v0.7.1 fixtures pass (regression — bundle mode unchanged).
2. All v0.8 fixtures pass (5 positive, 1 negative).
3. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean.
4. The orders↔payment worked example, compiled with `--target=workers`, produces the expected directory structure with all generated files structurally correct.
5. The generated wrangler.toml files are accepted by `wrangler` (`wrangler types` or `wrangler whoami` runs without complaint when pointed at them).
6. The generated TypeScript across all Workers compiles cleanly under `tsc --strict`.
7. Cross-context call lowering in workers mode correctly emits `callService(...)` invocations.
8. Service Binding declarations match the consumes graph.

A separate manual smoke test (not part of automated testing): deploy the two Workers via `wrangler deploy` and verify they actually communicate. This is documentation, not a test fixture.

---

## 8. v0.9 preview

What's coming after v0.8:

**Additional handler kinds.** v0.8 keeps `on call` as the only handler kind. v0.9 introduces:

- `on http POST /path { ... }` for HTTP routes — external consumers calling Karn services over HTTP.
- `on queue("name") { ... }` for queue consumers — durable, retryable processing.
- `on cron("0 * * * *") { ... }` for scheduled tasks.

Each adds its own runtime infrastructure: HTTP routing for `on http`, queue subscriptions and retry semantics for `on queue`, cron scheduling for `on cron`. The wire format and Service Binding work from v0.8 stays internal; v0.9's handlers face outward.

**Subsequent increments** in rough sequence:
- v0.10: State machines as sums. Agent state declared as a sum type with state-specific handlers.
- v0.11: Provider composition. Wrappers, decorators.
- v0.12: Refinement narrowing. Subset checking instead of exact match.
- v0.13: Sagas / compensation machinery.
- v0.14: Cross-context capability resolution.
- v0.15: Multi-Worker integration testing (miniflare-based).

After v0.9, Karn supports the external-facing edge of a Workers application. After v0.15, the language is broadly complete; remaining work is polish, ecosystem, and curriculum.
