# Adapters

An **adapter** is the one declaration kind where a Karn capability *contract*
sits adjacent to a non-Karn *implementation*. It is the **only** place the host
boundary may exist — the single, named, greppable seam through which a
deploy-target runtime or an npm library enters a Karn program. Everything else
stays pure Karn.

An adapter declares capabilities and the boundary types they reference, names a
TypeScript **binding** that supplies the implementations, and `exports` the
capabilities to consumers. It may **not** declare services or agents, and its
providers are **external** (bodiless).

## Anatomy

```karn,ignore
adapter tokens {
  binding "./tokens.binding.ts" requires { "jose": "^5" }
  consumes karn { Secrets }     -- v0.18: adapter-to-adapter dependency

  exports capability  { Jwt }
  exports transparent { Claims, JwtError }

  type Claims   = { sub: String, exp: Int }
  type JwtError = enum { Invalid, Expired }

  capability Jwt {
    fn sign(claims: Claims) -> Effect[String]
    fn verify(token: String) -> Effect[Result[Claims, JwtError]]
  }

  provides Jwt = JoseJwt given Secrets   -- external: no body; supplied by the binding
}
```

- **`binding "<module>"`** names the TypeScript module (resolved relative to the
  adapter's source file) that exports the provider symbols. `requires { … }`
  declares npm dependencies; ranges must be pinned (no `*`/`latest`).
- **`provides Cap = Name`** with **no brace block** is an *external* provider:
  the compiler emits no class, and the binding must `export class Name implements
  Cap`. The `implements` is checked by `tsc --strict` — that is the contract
  between the two halves.
- **`consumes U { Cap, … }`** (v0.18) brings another adapter's capabilities into
  scope for the adapter's providers — see
  [Adapter dependencies](#adapter-dependencies) below.

## Adapter dependencies

An adapter may depend on **another adapter's** capabilities (v0.18). Its
`consumes` is restricted on two axes, each with its own diagnostic:

- **braced form only** — an adapter has no services to call, so the whole-unit
  and `as Alias` forms are rejected (`karn.adapter.consumes_requires_selection`);
- **adapter targets only** — an adapter may not consume a *context*
  (`karn.adapter.consumes_context`).

An external provider names its dependencies with the ordinary `given`; compose
builds a **by-name deps object** and passes it to the binding class
constructor:

```typescript
// tokens.binding.ts — keys are the `given` names, checked by tsc
export class JoseJwt implements Jwt {
  constructor(private deps: { Secrets: Secrets }) {}
  // … this.deps.Secrets.get("JWT_SECRET") …
}
```

```typescript
// compose.ts (generated) — the dependency is instantiated recursively
const Jwt = new tokens__binding.JoseJwt({
  Secrets: new karn__binding.SecretsProvider(),
});
```

The wiring is transitive: depending on a capability pulls its provider's
binding into the compose (and *its* dependencies, recursively). This is how
config and IO reach a binding — a secret or an HTTP client is a capability
dependency (`given karn.Secrets`, `given karn.Fetch`), never an operation
parameter or an env read in application code.

## The three flavours

| Flavour | Binding | Portability |
|---|---|---|
| **Library adapter** | one, npm-backed, user-authored | runs anywhere |
| **The `karn` surface** | one per platform, toolchain-supplied | portable |
| **Vendor adapter** | one, vendor-only | platform-locked |

The **`karn` surface** is the reserved, agnostic conformance core shipped with
the toolchain; consuming only `karn` keeps code portable. The `karn` root
namespace is reserved — no user unit may be named `karn` or `karn.*`. As of
v0.18 it carries the full ambient set:

| Capability | Ops | Notes |
|---|---|---|
| `Clock` | `now() -> Effect[Int]` | |
| `Random` | `uuid() -> Effect[Uuid]`, `int(lo, hi) -> Effect[Int]` | `Uuid` is refined |
| `Logger` | `info(msg)`, `error(msg)` | |
| `Fetch` | `send(req: Request) -> Effect[Result[Response, FetchError]]` | typed core; see below |
| `Secrets` | `get(name: String) -> Effect[Option[String]]` | env-backed per platform |

`Fetch`'s `Request` carries `method` (`Method` enum), `url`, and
`contentType`/`authorization`/`body` as `Option[String]` fields; a general
`headers` list is deferred until Karn has a sequence type, and widening
`Request` later is additive.

### Platforms

The deploy **platform** (`--platform {cloudflare,node}`, default `cloudflare`)
selects which `karn-<platform>.ts` binding is linked. It is distinct from
`--target {bundle,workers}`, which chooses emit topology. Because the `karn`
contract names canonical provider symbols, the generated compose is
platform-identical — only the imported binding module differs. Porting Karn to
a new runtime means implementing this one adapter's interfaces.

## Consuming an adapter

A context `consumes` an adapter exactly as it consumes another context. Selected
capabilities can be flattened to bare names:

```karn,ignore
context auth.sessions {
  consumes karn   { Logger }   -- portable
  consumes tokens { Jwt }      -- library adapter; bare `Jwt` in scope

  service login {
    on call() -> Effect[String] given Jwt, Logger {
      let _     <- Logger.info("issuing token")
      let token <- Jwt.sign(Claims { sub: "u1", exp: 0 })
      token
    }
  }
}
```

`consumes U { Cap, … }` flattens the named capabilities into the consumer's local
namespace, so they read as `given Cap` / `Cap.op(…)` — identical to a locally
declared capability. The emitted TypeScript is the same as the qualified
`given U.Cap` form.

A consumed adapter is wired **in-process** (its binding is instantiated in the
composition root), never over a Service Binding — an adapter is not a deployment
unit.

## The binding as privileged constructor

A binding constructs its adapter's boundary types, which deliberately pierces
Karn's construction discipline (only the defining unit may construct a type).
Inside a binding that rule does not apply — the binding *is* the host boundary.
To avoid coupling to the emitter's lowering, bindings construct boundary values
**only through the emitted constructors** — `Ok`/`Err`/`Some`/`None` from
`runtime.js`, a sum type's `T.Variant`, a record as an object literal, and a
**refined type through its validating `.of`** (handling the `Result`; a raw cast
or `.unsafe` bypasses the predicate and is disallowed).

## See also

- [Wrap a library as an adapter](../how-to/adapters/wrap-a-library.md)
- [Capabilities & providers](capabilities.md)
- [Adapter & binding errors](../how-to/troubleshooting/adapter-errors.md)
