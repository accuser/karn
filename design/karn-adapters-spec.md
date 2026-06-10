# Karn Adapters — the Host Boundary

A spec for **adapters**: the one declaration kind in which a Karn capability
**contract** sits adjacent to a non-Karn **implementation**. An adapter, together
with the TypeScript **binding** it names, is the only place the host boundary is
allowed to exist — the single, named, greppable seam through which a deploy-target
runtime or an npm library enters a Karn program. Everything else stays pure Karn
and safe by construction.

Adapters come in three flavours, all the same kind:

- **Library adapters** — user-authored, a single npm-backed binding that runs on
  any target (`tokens` over `panva/jose`; `weather` over `fetch`).
- **The `karn` surface** — first-party; the **ambient** primitives Karn guarantees on
  every platform (`Clock`, `Random`, `Logger`, `Secrets`, `Fetch`), with **one binding
  per platform**. It is the *platform conformance surface*; its `karn` root namespace is
  **reserved for the toolchain**. Code that consumes only `karn` is portable. The
  surface is *ambient only* — no infrastructure ([§1.2], [O]).
- **Platform adapters** — first-party; a platform's **real** infrastructure capabilities
  as they actually are (`cloudflare` with `Kv`, `Queue`, …; later `aws`) — no portable
  intersection. Consuming one **locks its deployment unit to that platform** — a
  deliberate commitment, scoped per deployment unit (a context under `--target workers`,
  the whole bundle under the default `bundle`), propagating along `given` edges but not
  across service-consume RPC edges (§4.5, §5.3).

A consumer `consumes` any of them and uses the capabilities by bare name, unaware
of how they are implemented; the only thing that varies is *portability*. This
realises the design notes' **Tier 3 — platform bindings** and generalises it to the
**Anti-Corruption Layer** the notes describe (§"foreign types", §8). It builds on
**v0.15 cross-context capabilities**: the export-check, consumable-check and
provider-compose machinery are reused, but **bare-name flattening, clash detection
(§5.4), binding resolution (§3.5) and the platform-target axis (§6.2) are net-new**
— this is not a free ride on v0.15.

Read first: `grammar-increments/karn-mvp-grammar-v0.15.md` (cross-context
capabilities — this spec applies its machinery), `karn-design-notes.md` §8 (bounded
contexts; provided/consumed capabilities), the Tier-3 platform-bindings passage and
the Anti-Corruption-Layer discussion, `karn-type-system.md` §2.1.2, and v0.12
provider composition.

**Status.** This is the **as-built spec for v0.17** (merged as #18) *plus* the forward
design for v0.18 (platform adapters, config-as-capability, locking enforcement). §12
records the settled calls (▸); forward/v0.18 material is marked inline (e.g. the §1.2
design note, the §5 diagnostics rows, §10's `(v0.18)` markers) so a reader can tell
*record* from *proposal*. Items still genuinely open carry a **[DECISION]** letter and
live in §12.

---

## 1. Scope

### 1.1 The gap

Today `given` only resolves capabilities a **context declares and provides**, and
a `provides` body is **pure Karn** — there is no escape hatch to the host anywhere
in the compiler. Two consequences:

- **No host-backed capabilities.** Time, randomness, outbound IO, storage, and any
  npm library are unreachable. A user-written `SystemClock.now()` can only return a
  constant (fixture `170` returns `0`); it cannot call `Date.now()`.
- **No contained place to put one.** Even if a body could call the host, allowing
  it in *any* context would punch an FFI hole through the language's core property
  — that user source is pure and safe by construction.

`provides` outside a context is already rejected (`karn.provider.outside_context`,
`diagnostics.rs:~654`); a capability already compiles to a TypeScript `interface` plus
an injection token (`emit_capability`, `emitter.rs:~1854`); a provider already compiles
to `class X implements <Interface>` (`emit_provider`, `emitter.rs:~1885`). The adapter
fills the
gap with one new declaration kind permitted to bind a capability to an external
implementation — and nothing else gains that power.

### 1.2 Embrace the platform — two tiers, not three

> **Design note (post-v0.17, under review).** An earlier draft of this section
> proposed *three* portability tiers and a lossy portable "tier-2" port (a
> `karn.Kv` with selectable platform adapters). That is **dropped**. The reasoning
> and the simpler model it leaves are below; §§4.3, 5.3, 6.2, 12[I] follow from it.

Platform capabilities split by how portable they *genuinely* are — two tiers:

1. **Ambient primitives** — `Clock`, `Random`, `Logger`, `Secrets`, `Fetch`.
   Identical on every runtime; abstracting them costs nothing. These are the
   **`karn` surface**: portable, one binding per platform.
2. **Infrastructure** — KV, queues, blob storage, databases, and vendor-unique
   services (Durable Objects, Workers AI; DynamoDB, SQS, Step Functions).
   Semantics differ enough across platforms that a portable abstraction is a leaky
   lowest-common-denominator that lies about what's underneath. These live in
   **platform adapters** (`cloudflare`, `aws`) with **honest, platform-shaped
   capabilities** — not a neutered intersection.

Karn ships **no portable infrastructure layer**. A project targets a platform and
uses that platform's features — `consumes cloudflare { Kv, Queue }` — which is the
normal, expected case; the platform commitment is one greppable `consumes` line.
Imposing a guessed lowest-common-denominator port is a rod for the language's back:
it serves a cross-serverless portability story few projects want, at the cost of
real complexity (a selectable-provider mechanism, a foreign-capability provision
rule) and a dishonest abstraction.

**Portability, when a project genuinely needs it, is a user-authored adapter.** A
developer targeting both Cloudflare and AWS writes their own `myapp.store` adapter
over `cloudflare.Kv` and `aws.Dynamo`, choosing *their* lowest common denominator
for *their* needs — using the same adapter mechanism. The language provides the
tools; it does not impose the abstraction. (Karn is platform-shaped at its core
anyway — agents are Durable-Object-shaped — so a universal-portability claim was
never honest.)

### 1.3 The adapter model — three strata, one seam

The standard library has three strata; the host boundary falls between the second
and third:

1. **Pure stdlib** — types and pure functions (`Option`/`Result`/`Effect`; later
   string/math/json helpers). No host dependency. **Pure Karn.**
2. **Capability contracts** — `capability Clock { fn now() -> Effect[Int] }`.
   Target-independent interfaces; the surface `consumes`/`given` work against.
3. **Capability implementations** — `ClockProvider` calling `Date.now()`, `JoseJwt`
   calling `panva/jose`. Host code. **The adapter's binding** (a `.binding.ts`).

The contract (stratum 2) is read by three consumers at once — the *wiring*, the
*LSP*, and the *binding* — one source of truth.

### 1.4 Why a distinct kind (containment)

An adapter is not a context: it has no services, agents, or logic. Its own kind buys:

- **Containment.** External providers are legal **only** in an adapter; ordinary
  contexts remain provably free of host access. The host *boundary* is greppable —
  `adapter` finds the declared boundaries, and each adapter names its `.binding.ts`
  (§3.5), so the foreign **code** is exactly *those bindings*. (The dangerous code
  lives in the `.binding.ts`, not inside the Karn `adapter` unit — the auditable
  claim is "the boundary is greppable: `adapter` + its named binding," not "all
  foreign code sits inside adapter units.")
- **The marker dissolves.** A `provides` inside an adapter is external *by
  definition*: `provides Clock = ClockProvider` with no body is the normal form; a
  Karn body inside an adapter is the error.
- **It reads as architecture.** Capability-as-port, adapter-as-implementation.

### 1.5 In scope / out of scope

**In scope.**

- The `adapter` kind (§3): co-located contract + external providers + boundary types
  + `exports`; a named **binding** (§3.5); the reserved `karn` name prefix (§3.4).
- The **`karn` surface** (§4.2), **platform adapters** (§4.3, target-locked §5.3), and
  **library adapters** (§4.1).
- The **binding as privileged constructor** of its boundary types (§4.4).
- A minimal **platform-target axis** (§6.2), distinct from the existing
  `--target {bundle,workers}` emit mode; the MVP ships the `cloudflare` platform only.
- The MVP capability set (§9): the env-free `karn` core (`Clock`, `Random`,
  `Logger`) plus `tokens`/`weather` library adapters.

**Out of scope (deferred).**

- **The first platform adapter** (`cloudflare`: `Kv`, `Queue`) and the `karn` ambient
  additions (`Secrets`, `Fetch`) — these are v0.18. They bring adapter `consumes` +
  external-provider `given` wiring ([N]), config-as-capability ([M]), the binding
  reading `env` explicitly with `wrangler.toml` stanzas derived from platform-adapter
  metadata (no `needs`, §4.3), and live platform-lock enforcement.
- **Additional platforms** (Node, Deno) — the MVP is `cloudflare`-only; the axis
  exists so they are additive.
- **Durable Object state as a capability**; **decorate/wrap overrides** (§7.2);
  **target-aware library adapters**; **a public binding ABI**.

---

## 2. The design at a glance

| Flavour | Binding(s) | Portability | Reserved? | Example |
|---|---|---|---|---|
| Library adapter | one, npm-backed | runs anywhere | no | `tokens` (jose), `weather` (fetch) |
| `karn` surface | one per platform | portable | **yes** (`karn.*`) | `Clock`, `Random`, `Logger`, `Secrets`, `Fetch` ([O]) |
| Platform adapter | one, platform-only | **platform-locked** | no | `cloudflare` (`Kv`, `Queue`), later `aws` |

Mechanism (the same for all three): contract `capability Cap { … }`; external
`provides Cap = Sym`; a named `binding "<module>"`; bring into scope with `consumes U
{ Cap, … }`; override with a local `provides`; substitute with `mocks`.

Provider precedence: **test `mocks` › local `provides` › adapter default.**

---

## 3. Grammar

### 3.1 The `adapter` declaration — [DECISION A: keyword]

```
source-unit  ::= commons | context | test | adapter        -- adapter is NEW
adapter-decl ::= 'adapter' qualified-name adapter-body
adapter-body ::= '{' adapter-item* '}' | <fragment form>
adapter-item ::= binding-decl | capability-decl | provider-decl
               | type-decl | fn-decl | uses-decl | exports-decl
```

`adapter` is a new keyword (sibling to `commons`/`context`/`test`; not currently
reserved). An adapter may contain a binding declaration, capability declarations, the
boundary types they reference, **inline pure helper types and functions** (and `uses`
a commons to import shared ones — [DECISION B]), external providers, and `exports`. It
may **not** contain services, agents, or bodied providers — the effectful/logic kinds
that would make it a context. Inline helpers do not weaken containment: they are pure
Karn and cannot touch the host, so the host boundary is still only the binding (§3.5).

### 3.2 External providers (no body)

```
provider-decl ::= 'provides' cap-name '=' provider-name provider-body?
                                                       --   body  → Karn (context only)
                                                       -- no body → external (adapter only)
```

Inside an adapter, a provider has **no Karn body**: it names the implementation
symbol the binding must `export`. The compiler emits no class and records the
capability as binding-supplied. A *bodied* provider in an adapter is
`karn.adapter.provider_has_body`; a *bodiless* provider in a context is
`karn.context.external_provider`. The absence of the brace block — not an empty one
— is the signal.

### 3.3 Selected-capabilities `consumes` — [DECISION C]

```
consumes-decl ::= 'consumes' qualified-name                    -- whole, qualified (v0.4)
                | 'consumes' qualified-name 'as' identifier     -- aliased, qualified (v0.6)
                | 'consumes' qualified-name '{' name-list '}'   -- NEW: selected caps, bare names
name-list     ::= identifier (',' identifier)* ','?
```

```karn
consumes karn       { Clock, Logger }   -- portable
consumes tokens     { Jwt }             -- library adapter
consumes cloudflare { Kv }              -- platform adapter: locks this context to cloudflare (v0.18)
```

Each listed name must be a capability the unit **exports**; it enters the consumer's
local capability namespace under its bare name, so it reads as `given Clock` /
`Clock.now()`. Bare-name flattening into the local `capability_info_map` is a **new
resolution path** (v0.15 only resolved qualified `given U.Cap`); it is what creates
the collision surface handled in §5.4.

### 3.4 The reserved `karn` name prefix

Karn has no hierarchical namespaces: a dotted unit name (`shop.orders`, `karn.time`)
is a single **flat** identifier, not a tree — `karn` and `karn.time` are *independent*
units that merely share a leading segment. The toolchain **reserves any unit name whose
first segment is `karn`**: no user `commons`, `context`, `adapter`, or `test` may be
named `karn` or `karn.<anything>` (`karn.namespace.reserved`). That keeps the platform
conformance surface (§4.2) unambiguous and makes `consumes karn…` a reliable marker of
a portable dependency.

> **Migration note.** Reserving `karn.*` is a deliberate, *non-additive* change: any
> prior program that used `karn` as a leading segment for a user unit (e.g. a
> `commons karn.time`) no longer compiles and must be renamed off the reserved prefix.
> This is the one intended exception to "prior programs compile identically."

### 3.5 Binding resolution — [DECISION J]

Compose must import a provider's implementation symbol from *some* TypeScript module;
the rule must be explicit (it is the central mechanical contract of the feature, and
`karn.adapter.no_binding` presupposes it). An adapter names its binding module
explicitly — greppable and rename-surviving, preferred over filename magic:

```karn
adapter tokens {
  binding "./tokens.binding.ts" requires { "jose": "^5" }
  ...
  provides Jwt = JoseJwt
}
```

- The path is resolved **relative to the adapter's source file**. Compose emits
  `import { JoseJwt } from "<resolved path>"` and constructs it.
- The module must `export` each symbol named by the adapter's `provides`; the
  `implements` is checked by `tsc --strict` (the symbol's existence likewise — a
  missing export surfaces there, plus an early `karn.adapter.no_binding` if the
  module/clause is absent for an adapter that declares external providers).
- `requires { … }` declares npm dependencies, folded into the generated
  `package.json` ([DECISION F]; the alternative is a sidecar manifest). How those
  declared deps are surfaced, pinned and trusted — a supply-chain concern, since
  third-party library adapters are a goal — is **[DECISION L]**.
- The **`karn` surface** omits the clause: its binding is **platform-keyed** and
  resolved by the toolchain (`karn` → the active platform's `karn-<platform>.ts`,
  §6.2). It is the *only* case with no fixed module.
- A **platform adapter** *does* name its single binding with the same clause — the
  module is bundled with the toolchain rather than user-written, but naming it keeps
  resolution uniform (one binding, named, greppable), matching §4.3.

> The library binding (`tokens.binding.ts`) is an **input** the user writes — not an
> output emitted by the compiler. (§6.3 covers where *first-party* bindings live.)

---

## 4. Anatomy of an adapter

The contract is always target-agnostic; the *binding set* differs — one for a
library adapter (§4.1), one per platform for the `karn` surface (§4.2), one
vendor-only binding for a platform adapter (§4.3). §4.4 governs how a binding may
construct the boundary types.

### 4.1 A library adapter — `tokens` over `panva/jose`

```karn
adapter tokens {                       -- library adapters: named for the capability (see naming note, §12)
  binding "./tokens.binding.ts" requires { "jose": "^5" }

  exports capability  { Jwt }
  exports transparent { Claims, JwtError }

  type Claims   = { sub: String, exp: Int }
  type JwtError = | Invalid | Expired

  capability Jwt {
    fn sign(claims: Claims, secret: String)  -> Effect[String]
    fn verify(token: String, secret: String) -> Effect[Result[Claims, JwtError]]
  }

  provides Jwt = JoseJwt                -- defined by the binding below
}
```

The compiler emits the interface + token any capability produces (`emit_capability`,
`emitter.rs:~1854`), and *no* class for `JoseJwt`:

```ts
// tokens.ts (generated)
export interface Jwt {
  sign(claims: Claims, secret: string): Promise<string>;
  verify(token: string, secret: string): Promise<Result<Claims, JwtError>>;
}
export const JwtToken: unique symbol = Symbol("Jwt");
```

The binding (a user-authored input) implements that interface and constructs results
through the **emitted constructors** (§4.4), never raw tag shapes:

```ts
// tokens.binding.ts
import * as jose from "jose";
import type { Jwt, Claims } from "./tokens.js";
import { JwtError } from "./tokens.js";          // emitted variant constructors
import { Ok, Err, type Result } from "./runtime.js";

export class JoseJwt implements Jwt {
  async sign(claims: Claims, secret: string): Promise<string> { /* jose.SignJWT… */ }
  async verify(token: string, secret: string): Promise<Result<Claims, JwtError>> {
    try {
      const { payload } = await jose.jwtVerify(token, keyFrom(secret));
      return Ok({ sub: String(payload.sub), exp: Number(payload.exp) });  // Claims object literal
    } catch (e) {
      return Err(isExpired(e) ? JwtError.Expired : JwtError.Invalid);     // emitted ctors
    }
  }
}
```

`implements Jwt` against the generated interface **is** the contract between the two
halves, checked for free by `tsc --strict`.

### 4.2 The `karn` surface — the agnostic conformance core

First-party; its contract is **Karn-owned and platform-agnostic**, with **one binding
per platform**, and no `binding` clause (the toolchain supplies them). The MVP core:

```karn
adapter karn {                      -- the reserved, agnostic surface; shipped with the toolchain
  exports capability  { Clock, Random, Logger }
  exports transparent { Uuid }

  type Uuid = String where Matches("[0-9a-f]{8}-[0-9a-f]{4}-…")   -- refined ([G])

  capability Clock  { fn now() -> Effect[Int] }
  capability Random {
    fn uuid() -> Effect[Uuid]                 -- refined, not bare String
    fn int(lo: Int, hi: Int) -> Effect[Int]
  }
  capability Logger {
    fn info(msg: String)  -> Effect[()]
    fn error(msg: String) -> Effect[()]
  }

  provides Clock  = ClockProvider     -- canonical symbols every platform binding must export
  provides Random = RandomProvider    -- (neutral, contract-flavoured names — see [DECISION H])
  provides Logger = LoggerProvider
}
```

Each platform supplies a binding implementing those canonical symbols (sharing code
where the host API is identical). Note `RandomProvider.uuid` constructing the refined
`Uuid` through its validating `.of` (§4.4) — `.unsafe` is not used even though crypto
guarantees validity:

```ts
// karn-cloudflare.ts            (also karn-node.ts, karn-deno.ts, …)
import type { Clock, Logger, Random, Uuid } from "./karn.js";
import { Uuid as Uuid_ } from "./karn.js";    // validating .of constructor
export class ClockProvider   implements Clock  { async now() { return Date.now(); } }
export class LoggerProvider  implements Logger {
  async info(m: string)  { console.log(m); }
  async error(m: string) { console.error(m); }
}
export class RandomProvider implements Random {
  async uuid(): Promise<Uuid> {
    const r = Uuid_.of(crypto.randomUUID());            // predicate runs (defence-in-depth)
    if (r.tag === "Err") throw new Error("unreachable: crypto uuid failed Uuid");
    return r.value;
  }
  async int(lo: number, hi: number): Promise<number> { /* getRandomValues in [lo,hi] */ return lo; }
}
```

(`Effect[Int]` lowers to `Promise<number>`; `Effect[()]` lowers to `Promise<void>` —
`ts_type_ref` maps `Unit` to `void` in the emitted interface, so the binding's
`Promise<void>` matches under `--strict`; verified at `ts_type_ref`, `emitter.rs:~4418`, and fixture
`170`'s `now(): Promise<number>`.) Because the contract names canonical symbols,
every platform's binding exports the same names and the generated compose is
**platform-identical** — only the imported binding module changes (§6.2). The `karn`
surface is the **platform conformance surface**: porting Karn to a new runtime means
implementing this one adapter's interfaces, with no change to consumer or domain code.

> **Implementation note (verified, Phase 4).** "The `karn` surface is just an adapter"
> is literal: the toolchain ships the adapter *source* and, when a project `consumes
> karn`, injects it as a synthetic adapter unit that flows through the ordinary
> pipeline — no bespoke emission. Its binding is provided per platform; the injection is
> conditional on `consumes karn`, so projects that don't use it are unaffected.

> The surface may be one adapter (`karn`) or several **independent** flat-named units
> (`karn.time`, `karn.log` — not a hierarchy; §3.4); the MVP ships a single `karn`, and
> splitting later is purely additive ([DECISION E]). Whether canonical provider symbols
> read as contract obligations (`ClockProvider`) or are platform-chosen via a manifest
> is [DECISION H].

### 4.3 Platform adapters — a platform's real capabilities

A platform adapter (`cloudflare`, later `aws`) is first-party, has a **single binding
tied to that platform**, and exposes that platform's capabilities **as they actually
are** — no portable intersection. Consuming one *is* the platform commitment (§5.3).

```karn
adapter cloudflare {
  binding "./cloudflare.binding.ts"        -- first-party; bundled with the toolchain
  exports capability { Kv, Queue }

  capability Kv {
    fn get(key: String)                -> Effect[Option[String]]
    fn put(key: String, value: String) -> Effect[()]
  }
  capability Queue {
    fn send(body: String) -> Effect[()]     -- producer side; the consumer is the `on queue` handler
  }

  provides Kv    = WorkersKv
  provides Queue = WorkersQueue
}
```

The binding reads `env` **itself** — explicitly, in its own TypeScript — for the
platform resources it needs. There is **no `needs` clause and no compiler "inject env"
magic**: a platform binding is the one place that reads `env`, and it does so in code
you can see (compose passes `env`, which it already threads, to these first-party
bindings).

```ts
// cloudflare.binding.ts
import type { Kv } from "./cloudflare.js";
import { Some, None, type Option } from "./runtime.js";

export class WorkersKv implements Kv {
  constructor(private env: { KV: KVNamespace }) {}      // reads env explicitly
  async get(key: string): Promise<Option<string>> {
    const v = await this.env.KV.get(key);
    return v === null ? None : Some(v);
  }
  async put(key: string, value: string): Promise<void> { await this.env.KV.put(key, value); }
}
```

The compiler's jobs here are **derived, not injected**, and all are *visible outputs*:
type `env.KV` in the generated `Env`, emit the `[[kv_namespaces]]` `wrangler.toml`
stanza, and record the platform lock — all from the platform adapter's own first-party
metadata. The application never touches `env`; it just `consumes cloudflare { Kv }`
and `given Kv`.

A parallel `adapter aws { Dynamo, Sqs, … }` is an independent unit with its own
binding — no requirement to match `cloudflare`, and **no shared `Kv` port**. A project
that wants to abstract across both writes its own adapter (§1.2).

### 4.4 The binding as privileged constructor of boundary types

A binding constructs its adapter's boundary types. For **transparent** types this is
*not* a privilege: transparent export already affords field-level construction at any
consumer (verified — §6.1; the §8 example builds `Claims { … }` inside `auth.sessions`).
The binding's privilege bites only on the **stricter** kinds Karn otherwise restricts:

- **Refined** types — construction must run the validating `.of` predicate; a raw cast
  or `.unsafe` mints a value the rest of Karn trusts as validated without checking it
  (detailed below). This is where the binding is genuinely a privileged constructor, and
  the `.of` discipline exists to contain it.
- **Opaque** types — token-only outside the defining unit (`Visibility::Opaque`); only
  the defining unit may construct one. A binding that builds an opaque boundary type
  steps outside that rule, and only `tsc` checks shape there.

So **the binding is a privileged constructor relative to refined and opaque boundary
types** — not transparent records, which any consumer may build (design-notes §§155/336
describe the restricted cases).

Whichever kind it builds, a binding constructs boundary values **only through the
emitted constructors**, never open-coded tags — so hand-written bindings do not couple
to the emitter's internal ADT lowering:

- `Result` / `Option` via `Ok`/`Err`/`Some`/`None` imported from `runtime.js`
  (`{ tag: "Ok", value }` etc. — `emitter.rs:57`).
- each **sum type** via its emitted constructor namespace — `JwtError.Invalid`,
  `JwtError.Expired` (the emitter emits `JwtError = { Invalid: { tag: "Invalid" } as
  JwtError, … }`; cf. fixture `102`).
- each **record** as an object literal satisfying the emitted `interface` (structural;
  `tsc` checks it).

Writing `{ tag: "Invalid" }` by hand is disallowed by convention — it would break the
moment the lowering changes. (Design note, not a pending decision: if record
construction ever needs more than an object literal, the runtime should export record
constructors too, on the same principle.)

**Refined boundary types are a sharper case.** A refined type emits a *branded* alias
with a validating constructor `T.of(v) -> Result[T, ValidationError]` (plus a `T.unsafe`
escape hatch) — `emitter.rs:6`. `tsc` checks only the brand and shape, **never the
refinement predicate**, so a raw `value as Sku` cast (or `Sku.unsafe(value)`) would mint
a refined value the rest of Karn trusts as validated *without running its predicate*. A
binding must therefore construct a refined boundary type through its emitted `.of`
constructor and handle the `Result`; raw casts and `.unsafe` are disallowed by the same
convention as raw tags. **This holds even when the binding is a trusted *generator*** of
a value it believes valid: the `karn` surface's `Random.uuid()` ([G]) returns a refined
`Uuid`, and its binding still goes through `Uuid.of(crypto.randomUUID())`, unwrapping the
`Ok` and treating the (unreachable) `Err` as a bug — the predicate runs as
defence-in-depth rather than being trusted away. So this rule is **live in the MVP**, not
latent.

### 4.5 Adapter-to-adapter capability dependencies

An adapter's external provider may depend on **another adapter's capability** via the
ordinary `given` — the same by-name `deps` object v0.12 already uses (the
`emit_provider` deps object, `emitter.rs:~1910`). This is how config and IO reach a binding *without* an env clause:
a `Secrets`/`Fetch` capability (on the `karn` surface) is just another dependency.

```karn
adapter tokens {
  binding "./tokens.binding.ts" requires { "jose": "^5" }
  consumes karn { Fetch, Secrets }          -- adapters may consume capabilities (NEW; v0.17 had no consumes)
  exports capability  { Jwt }
  exports transparent { Claims, JwtError }
  type Claims = { sub: String, exp: Int }   type JwtError = | Invalid | Expired
  capability Jwt { fn verify(token: String) -> Effect[Result[Claims, JwtError]] }
  provides Jwt = JwksJwt given Fetch, Secrets   -- key fetched from a JWKS service; URL from Secrets
}
```

The binding receives them in the by-name `deps` object (`constructor(private deps: {
Fetch: Fetch; Secrets: Secrets })`, reads `this.deps.Fetch` — keys are the `given`
names, checked by `tsc`; nothing positional). Compose assembles the object by
instantiating the depended-on providers, recursing through the v0.15 provider graph;
the external branch of `instantiate_provider_expr` (`project.rs`) must build and pass
the `deps` object rather than short-circuiting to a no-arg constructor.

**Lock propagates along `given` edges, because they are in-process.** That recursion
instantiates the whole closure in *one* compose, so depending on a platform-native
capability pulls its binding into your deployment unit and locks it (§5.3). A
service-consume edge (`consumes B` to call B's services) is Service-Binding **RPC** —
a separate Worker — so it does *not* propagate lock. **Two new mechanisms** this needs
(neither in v0.17): adapters gain `consumes` (`AdapterDecl` has no `consumes` field
today), and external providers gain real `given` wiring.

---

## 5. Static semantics

### 5.1 Resolving a selected-capabilities `consumes`

For `consumes U { C1, … }` in a consumer: `U` must be consumable and (for an adapter)
linked; each `Ci` must be a capability `U` **exports** (`karn.given.cross_context_unknown_capability`,
`diagnostics.rs:~270`, reused); each `Ci` enters the consumer's local capability
namespace under its bare name (the **net-new** flattening path — §3.3 — over which
clash detection runs, §5.4).

### 5.2 Provider selection vs instance lifetime

Per build, **exactly one provider *binding* is selected per capability** — the impl
choice (adapter default, local override, or mock — see the precedence line below).
That is *not* one
instance: by default each consuming context's `compose` constructs its **own**
instance (`new karn.ClockProvider()` per compose, as fixture `170` shows). The
distinction is irrelevant for stateless caps (`Clock`) but a correctness question for
stateful ones (a KV client, a connection, a cache): two contexts taking the default
`Kv` get **two instances** unless sharing is requested. Shared/singleton provider
instances are a deferred feature; v1 is per-compose.

Precedence for the impl choice: **mocks › local `provides` › adapter default.**

### 5.3 The platform-locking rule — per deployment unit

The invariant is target-independent: **platform lock is local to a *deployment unit*** —
the unit that physically runs on one platform. It arises only from in-process use of a
**platform-native** capability, one whose binding runs only when deployed on that
platform (Cloudflare `Kv`, Durable Objects). What *counts* as a deployment unit depends
on the build target (`cli.rs` `CliTarget`):

- **`--target workers`** — one Cloudflare Worker per context; cross-context calls go over
  Service Bindings (RPC; `emitter/workers.rs`). The deployment unit **is the context**, so
  `consumes <context>` crosses a deployment-unit boundary and the lock **does not
  propagate** across it: a context's lock is exactly its own `consumes <native>` lines,
  greppable, nothing inherited. That edge may even cross *platforms* — A on Cloudflare
  calling B on AWS is a remote call (a natural, currently-unbuilt extension).
- **`--target bundle`** (the default) — cross-context calls compile to **direct
  in-process invocation**; the **whole program is one deployment unit**. The bundle's
  effective platform is the **union** of its contexts' native uses: if *any* context uses
  `Kv`/DO, the entire bundle is a Cloudflare deployment, and a context sharing that bundle
  is locked **without a native `consumes` line of its own**. Here the lock is
  co-locational — not through the `consumes` edge, but through sharing one bundle.

So, precisely: lock is **per deployment unit**; the `consumes` edge crosses deployment-
unit boundaries **only under `workers`**. `karn.target.vendor_required` fires when a
deployment unit uses a native capability but targets another platform;
`karn.target.vendor_conflict` when one deployment unit mixes two mutually-exclusive native
runtimes — *within a context* under `workers`, *anywhere in the bundle* under `bundle`.

Two things hold in both modes:

- **A remote vendor API is not a platform adapter.** AWS S3 over HTTPS is reachable
  from any runtime — wrap it as an ordinary **library adapter** (its credentials arrive
  as a `given karn.Secrets` capability), and it does **not** lock. Only **platform-native
  runtime bindings** (`Kv`, Queue, Durable Objects) lock — and those are exactly what a
  **platform adapter** exposes.
- The `karn` surface and library adapters impose no platform constraint at all.

> **MVP note.** The `karn` core (`Clock`, `Random`, `Logger`) has **no** platform-native
> capabilities, so the whole bundle-vs-workers locking distinction is **latent this
> increment**; it goes live only with the first platform adapter.

### 5.4 Flattening scope — [DECISION D]

`consumes U { Cap }` flattening is defined for any exporting unit (per [D], general — not
adapter-only). A collision — two consumed units exporting the same bare name, or one
clashing with a local capability — is **rejected** with `karn.consumes.capability_name_clash`,
resolved by the qualified `given U.Cap` form or `consumes U as Alias`.

### Diagnostic codes

| Code | Status | Cause |
|---|---|---|
| `karn.adapter.provider_has_body` | new (v0.17) | a provider inside an `adapter` has a Karn body |
| `karn.context.external_provider` | new (v0.17) | a bodiless (external) provider outside an adapter |
| `karn.adapter.disallowed_item` | new (v0.17) | a `service` or `agent` in an adapter (a bodied provider is `provider_has_body`) |
| `karn.adapter.no_binding` | new (v0.17) | an adapter declares external providers but no binding clause/module/symbol is resolvable |
| `karn.namespace.reserved` | new (v0.17) | a user unit whose name's first segment is `karn` |
| `karn.target.vendor_required` | **v0.18 (deferred)** | a deployment unit using a platform-native capability built for another platform |
| `karn.target.vendor_conflict` | **v0.18 (deferred)** | a deployment unit (a context under `workers` / the whole `bundle`) mixing two mutually-exclusive native runtimes |
| `karn.given.cross_context_unknown_capability` | reused | `consumes U { Cap }` where U doesn't export `Cap` |
| `karn.consumes.capability_name_clash` | new (v0.17) | two flattened bare names collide |

---

## 6. Compilation to TypeScript

### 6.1 Compose wiring

For `consumes karn { Clock, Logger }` with no override, compose imports the providers
from the resolved binding (§3.5) and injects them — the deps-injection path of fixture
`170`:

```ts
// shop.orders compose.ts (generated)
import * as karn from "./karn-cloudflare.js";   // platform-resolved binding (§6.2)
const Clock  = new karn.ClockProvider();
const Logger = new karn.LoggerProvider();
const deps   = { Clock, Logger, env };
```

A local `provides Clock = FixedClock { … }` emits `class FixedClock implements Clock`
and compose constructs that; `mocks Clock` substitutes in the test build. `Clock.now()`
lowers to `deps.Clock.now()` in every case.

**Consuming an adapter is in-process, never RPC (verified, fixtures 176/177).** This is
the emitter-level reading of §5.3: an adapter is *not* a deployment unit. A consumed
*context* in `--target workers` is a separate Worker reached over a Service Binding, but
a consumed *adapter* is wired in-process via its binding. Concretely, for a consumer of
an adapter:

- the binding `.binding.ts` is **copied verbatim into the output** beside the adapter's
  emitted interface module, so the `import` resolves and `tsc --strict` checks the
  `implements` contract;
- compose instantiates the external provider from the binding module
  (`new tokens__binding.JoseJwt()`) — in `workers` it imports the binding at the out
  root (`../../tokens.binding.js`), in `bundle` at `./tokens.binding.js`;
- the consumer imports the adapter's capability **types** from the adapter's root module
  (`tokens.ts`), *not* from a per-Worker `handlers.ts` (an adapter has none);
- a consumed adapter therefore produces **no Service Binding** — no `Env` entry, no
  `wrangler.toml` binding — in either target. Only consumed *contexts* do.

This also means a consumer may construct an adapter's **transparent** boundary types
(e.g. `Jwt.sign(Claims { … }, secret)` in §8) — confirmed to compile and type-check;
transparent export affords field-level construction at the consumer, the binding is the
*privileged* constructor only for the stricter cases (refined types, §4.4).

### 6.2 Platform target (a new axis) and deploy bindings

The deploy **platform** (cloudflare / node / deno) is a **new selection axis** this
spec introduces. It is **distinct from the existing `--target {bundle,workers}`**
(`cli.rs` `CliTarget` / `BuildTarget`), which chooses emit topology, not a runtime.
There is no platform concept in the compiler today, so even the env-free MVP needs a
minimal one — the MVP is **not** target-free.

- **MVP:** a single platform, `cloudflare` (the existing `workers` emit mode targets
  Cloudflare Workers). Platform selection is a one-entry stub; the toolchain links
  `karn-cloudflare.ts`. The `karn-<platform>.ts` naming and the selection point are
  introduced now so Node/Deno are additive.
- **Selection** (the shipped `--platform cloudflare`, defaulting to `cloudflare`) picks
  which `karn-<platform>.ts` links. Because the `karn` contract names canonical
  symbols, the Karn-side compose is platform-identical; only the import differs.
- **Platform resources from `env`.** A platform adapter's binding reads `env`
  **itself** (§4.3) — there is no `needs` clause and no per-resource injection. Compose
  passes `env` (which it already threads) to these first-party bindings; the compiler's
  derived work is to type the resource field in `Env` and emit the `wrangler.toml`
  stanza, both from the platform adapter's first-party metadata. Config a *library*
  adapter needs (a secret, a JWKS URL) arrives as an ordinary `given karn.Secrets` /
  `given karn.Fetch` capability (§4.5), never as `env` at the application layer.

### 6.3 Binding distribution — [DECISION F]

- **Library adapter**: the binding is a **user input** named by the `binding` clause
  (§3.5); its npm deps fold into `package.json`.
- **`karn` surface / platform adapter**: the toolchain **supplies** the binding (`karn`
  per platform; a platform adapter one binding), and per [F] first-party bindings are
  **emitted into the project** (inspectable, no hidden dependency) — not a published
  package.

---

## 7. Testing & override

### 7.1 Testing — a mock plus a partial link

A consumed capability sits in the local namespace, so it is mocked with the same
`mocks` surface as a local provider (fixture `104`):

```karn
test shop.orders {
  mocks Clock  = FrozenClock  { fn now() -> Effect[Int] { 1_700_000_000 } }
  mocks Logger = SilentLogger {
    fn info(msg: String)  -> Effect[()] { () }
    fn error(msg: String) -> Effect[()] { () }
  }

  test "stamps the order with the clock" {
    let order <- ordering.call("ABC-123")
    assert order.placedAt == 1_700_000_000
  }
}
```

One thing is *not* fixture-104-verbatim: 104 mocks a local Karn provider, whereas
mocking an **adapter default** means the test build must **partially link the binding**
— link the impls for un-mocked caps, suppress the binding for the mocked ones. That
partial-link selection is new wiring. The payoff stands: time, randomness and IO are
injected, `Effect`-tracked, and deterministically mockable — a `cloudflare`-consuming
context's test runs without Cloudflare.

### 7.2 Override is replace, not decorate (for now)

Replacing the adapter default with a pure impl is in scope (`provides Clock =
FixedClock { … }`). Decorating it (wrapping the adapter's impl) needs a way to name the
shadowed base (the "super" problem) and is deferred.

---

## 8. Worked examples

A library adapter consumed by a portable context:

```karn
context auth.sessions {
  consumes karn   { Logger }   -- portable
  consumes tokens { Jwt }      -- portable (jose runs anywhere)

  service login {
    on call(secret: String) -> Effect[String] given Jwt, Logger {
      let _     <- Logger.info("issuing token")
      let token <- Jwt.sign(Claims { sub: "u1", exp: 0 }, secret)
      token
    }
  }
}
```

A portable consumer of the `karn` surface — only the `consumes karn { … }` line
distinguishes it from a hand-rolled local capability:

```karn
context shop.orders {
  uses money                        -- pure: types + functions
  consumes karn { Clock, Logger }   -- effectful: capabilities, bare names; portable

  type Order = { sku: String, placedAt: Int }

  service ordering {
    on call(sku: String) -> Effect[Order] given Clock, Logger {
      let _   <- Logger.info("placing order")
      let now <- Clock.now()
      Order { sku: sku, placedAt: now }
    }
  }
}
```

A context that opts into a platform-native vendor capability — locked to Cloudflare at
this line. Under `--target workers` a context that merely `consumes catalog.cache` calls
it over RPC and stays unlocked; under the default `bundle` it shares the deployment and
the lock with it (§5.3):

```karn
context catalog.cache {
  consumes karn       { Logger }   -- portable part
  consumes cloudflare { Kv }       -- vendor: this unit now requires the cloudflare platform

  service cache {
    on call(key: String) -> Effect[Option[String]] given Kv {
      let hit <- Kv.get(key)
      hit
    }
  }
}
```

The foreign **code** is the named bindings (`tokens.binding.ts`, the toolchain's
`karn`/`cloudflare` bindings); the foreign **boundaries** are greppable as `adapter`.

---

## 9. The MVP capability set

Prove the mechanism on the **env-free `karn` core** first — no `wrangler` wiring —
plus `tokens`/`weather` as library exemplars. The `cloudflare` platform adapter and
the `karn` ambient additions (`Secrets`, `Fetch`) follow in v0.18 (§13).

| Capability | Adapter | Ops | Binding maps to |
|---|---|---|---|
| `Clock` | `karn` | `now() -> Effect[Int]` | `Date.now()` |
| `Random` | `karn` | `uuid() -> Effect[Uuid]` (refined), `int(lo,hi) -> Effect[Int]` | `crypto.randomUUID()` / `getRandomValues` |
| `Logger` | `karn` | `info(String) -> Effect[()]`, `error(String) -> Effect[()]` | `console.*` |
| `Jwt` | `tokens` (library) | `sign`, `verify` | `panva/jose` |
| `Weather` | `weather` (library) | `current` | a remote API over `fetch` |

(The §4.2 `karn` example shows exactly this core — `Clock`, `Random`, `Logger`.)
`Fetch` joins the `karn` core as a fast follow (env-free, but real request/response
type design). ID-result typing ([DECISION G]): refined (`Uuid`) vs plain `String`.

> **`weather` in v0.17.** Because `karn.Fetch`/`Secrets` only arrive in v0.18, the v0.17
> `weather` binding necessarily calls the global `fetch` directly and takes its URL/key
> as plain operation parameters. That is legitimate — a binding is host code — and it is
> the exact case [M]/[N] tidy up: in v0.18 `weather`/`tokens` are revised to `given
> karn.Fetch, karn.Secrets` instead (§13).

---

## 10. Implementation notes

### 10.1 Where new code goes

| Area | File | Change |
|---|---|---|
| AST | `ast.rs` | new `Adapter` `SourceUnit`; optional `ProviderDecl.body`; `binding` decl |
| Parser | `parser.rs` | `adapter q { … }`; `binding "<path>" requires {…}`; bodiless `provides`; adapter item rules; reject `karn`/`karn.*` user units |
| Resolver | `resolver.rs` | flatten selected caps to bare names; carry binding module + provider symbols. *(v0.18: record platform-adapter platform; compute effective platform transitively.)* |
| Checker | `project.rs` / `checker.rs` | adapter item rules; bodiless-vs-bodied placement; clash; treat external provider as "provided". *(v0.18: platform-lock propagation + conflict.)* |
| Emitter | `emitter.rs` `emit_provider` | emit no class for external providers; emit interfaces/types/exports as usual |
| Emitter (compose) | `emitter/workers.rs` | import provider from the resolved binding module; construct; deps; partial-link for mocks; `env` threading (later) |
| Platform axis | `cli.rs` / `project.rs` | a minimal `--platform` (MVP: `cloudflare` only), distinct from `--target {bundle,workers}`; select `karn-<platform>.ts` |
| Link / project | `project.rs` | resolve `binding` modules; fold library npm deps into `package.json`; first-party binding provisioning |
| `karn` + vendor sources | first-party `adapter` + bindings embedded in the toolchain | `Clock`/`Random`/`Logger`; later `cloudflare` |
| Diagnostics | `diagnostics.rs` | the new codes (§5) |

### 10.2 Risk areas

- **Binding resolution** — relative-path resolution, missing-export detection (early
  vs at `tsc`), and npm-dep provenance without arbitrary build-config injection.
- **Platform axis vs emit mode** — `--platform` (new) must not be conflated with
  `--target {bundle,workers}` (existing).
- **Platform lock is per deployment unit** — the context under `--target workers`, the
  whole program under `bundle`; derive each unit's effective platform from the native
  capabilities it contains (don't propagate across the `consumes` RPC edge under
  `workers`); distinguish platform-native bindings (lock) from remote-API library adapters.
- **Partial link for mocks** — suppress the binding for mocked caps, link it for the
  rest.
- **Adapter item discipline; reserved `karn` prefix; bare-name clashes.**
- **Refined boundary construction** — a binding must build a refined boundary type via
  its validating `.of`, never a raw cast or `.unsafe`; `tsc` enforces the brand but not
  the predicate, so a bypass is invisible to the gate (§4.4).
- **`tsc --strict` across the seam** — interface, binding `implements`, deps object.

### 10.3 What "done" looks like

1. Prior fixtures pass (additive).
2. `consumes karn { Clock, Logger }` compiles; emitted handler matches local-capability
   output; compose injects the platform-resolved `karn` binding.
3. A `tokens` adapter compiles; its `binding` module resolves; `implements Jwt`; npm
   dep reaches `package.json`; a consumer signs a token; the binding constructs results
   via emitted constructors only.
4. **(v0.18, not this increment — latent until the first platform adapter ships, §5.3.)**
   A deployment unit using a platform-native capability builds only for that platform;
   under `workers` a context that merely `consumes` it over RPC stays unlocked; two
   mutually-exclusive native runtimes in one deployment unit conflict.
5. A user unit named `karn`/`karn.*` is rejected.
6. Override and `mocks` beat the default per precedence; a mocked-cap test partially
   links the binding.
7. Emitted output passes `tsc --strict`; `cargo test`, clippy, fmt clean.

---

## 11. Tooling & docs delta (required)

- **tree-sitter** / **vscode** / **karn-fmt**: the `adapter` unit, the `binding`
  clause, bodiless `provides`, braced `consumes`; corpus + idempotency fixtures;
  keyword list gains `adapter`.
- **karn-lsp**: `consumes ` autocompletes the `karn` surface, platform adapters and
  project adapters; capability/hover from the contract; surface a platform adapter's
  platform lock and a unit's **effective platform** (§5.3).
- **Docs**: an "Adapters" reference (three flavours, the `karn` surface, vendor
  adapters, reserved `karn` prefix, binding resolution, the privileged-constructor rule,
  per-deployment-unit platform locking (bundle vs workers), `consumes`-as-RPC); a "Wrap a
  library as an adapter"
  how-to (jose /
  the `weather` fetch example); troubleshooting for the new diagnostics; regenerate
  `grammar.md` + `diagnostics.md`.

---

## 12. Decisions

**Settled in review** (▸ marks the call):

1. **[A] Keyword** — ▸ `adapter`.
2. **[B] Adapter contents** — ▸ inline pure helper types/functions and `uses` are
   allowed; no services, agents, or bodied providers. Pure helpers don't pierce
   containment (they can't touch the host), so the boundary is still only the binding.
3. **[C] Mixin clause** — ▸ `consumes U { … }` (the effectful edge; not `uses`).
4. **[D] Flattening scope** — ▸ general; a clash is `karn.consumes.capability_name_clash`.
5. **[E] `karn` surface shape** — ▸ Karn names are flat (no hierarchy); one `karn`
   adapter for the MVP, splittable later into independent `karn.*` units; the leading
   `karn` segment is reserved (§3.4).
6. **[F] Binding distribution** — ▸ a library binding is a user input named by the
   `binding` clause; first-party bindings are emitted into the project; npm deps are
   declared in the `binding` clause.
7. **[G] ID types** — ▸ refined (`Uuid`); the binding constructs it via the validating
   `.of`, even as a trusted generator (§4.4).
8. **[H] `karn` provider symbols** — ▸ canonical, contract-flavoured names (e.g.
   `ClockProvider`; avoid impl-flavoured `SystemClock`), not per-platform manifest.
9. **[I] Infrastructure portability** — ▸ **no portable infrastructure port at all**
   (collapses the old "tier 2", §1.2). The `karn` surface is *ambient primitives only*;
   infrastructure (KV, queues, storage, DB) lives in platform adapters with honest,
   platform-shaped capabilities. Portability, where wanted, is a **user-authored**
   abstraction adapter, not a language feature. (Supersedes an interim draft that
   proposed a portable `karn.Kv` with selectable providers.)
10. **[J] Binding resolution** — ▸ an explicit `binding "<module>"` clause (greppable,
    rename-safe).
11. **[K] Platform lock** — ▸ per **deployment unit**: a context under `--target workers`
    (the `consumes` RPC edge doesn't propagate lock), the whole program under the default
    `bundle` (co-location locks the shared bundle). Lock propagates along `given`/capability
    edges (in-process), not service-consume (RPC) edges (§4.5). Platform-native bindings
    lock, remote-API library adapters don't; cross-platform RPC is a future extension (§5.3).
12. **[M] Binding configuration** — ▸ **no `needs` clause.** A binding's dependencies are
    all `given` capabilities (the v0.12 by-name `deps` object). Config/IO is a capability
    (`karn.Secrets`, `karn.Fetch`); `env` is read **only** inside first-party `karn`/platform
    bindings, explicitly, never injected into application adapters (§4.3, §4.5). (An
    interim `needs <kind> "NAME"` clause was considered and rejected — it conflated config
    with vendor wrangler bindings and would grow with every platform resource type.)
13. **[N] Adapter-to-adapter dependencies** — ▸ adapters gain `consumes`, and an external
    provider's `given` is wired through the `deps` object (§4.5). Two genuinely new
    mechanisms over v0.17 (`AdapterDecl` has no `consumes`; the external-provider branch of
    `instantiate_provider_expr` currently passes no deps).
14. **[O] `karn` surface scope** — ▸ ambient primitives only: `Clock`, `Random`, `Logger`,
    `Secrets`, `Fetch`. No infrastructure capability ever joins the `karn` surface; a `karn`
    capability may not depend on a platform-native one (it must stay portable).

**Still open:**

15. **[L] Adapter dependency trust** — direction set (declared `requires` deps pinned and
    surfaced for review), but the full allow-list / confirmation policy is TBD. A
    supply-chain surface (a malicious adapter could declare `requires { "evil": "*" }`),
    load-bearing because third-party library adapters are a goal.

**Naming-convention note.** The three flavours name themselves differently — `tokens`
(by capability), `cloudflare` (by vendor), `karn` (by toolchain). Since the doc makes
naming carry meaning, this is a mild inconsistency; the working rule is *library
adapters by capability, platform adapters by vendor, the reserved surface as `karn`*.
Worth stating in docs rather than pretending it's uniform.

---

## 13. Roadmap

- **This increment:** the `adapter` kind, bodiless external providers, the `binding`
  clause, `consumes U { … }`, the reserved `karn` prefix, a minimal `--platform`
  (cloudflare), and the env-free `karn` core (`Clock`, `Random`, `Logger`), plus
  `tokens`/`weather` library exemplars.
- **Next — split into two slices** (see `grammar-increments/karn-mvp-grammar-v0.18.md`):
  - **v0.18 (wiring + ambient):** `Secrets` + `Fetch` on the `karn` ambient surface;
    **adapters `consumes` + external-provider `given` wiring** (§4.5, [N]); a second
    platform value (`--platform node`) so the platform axis is observable.
    (Config-as-capability, [M], means the existing `tokens`/`weather` adapters are
    revised to drop their secret/URL params.)
  - **v0.19 (platform):** the first **platform adapter** `cloudflare` (`Kv`, `Queue`)
    with its binding reading `env` explicitly and the `wrangler.toml` stanzas derived
    from platform-adapter metadata (no `needs`, no injection); platform-lock
    enforcement going live.
- **Later:** more `karn` platforms (Node, Deno); an `aws` platform adapter; shared/
  singleton provider instances; the decorate/wrap override; a public binding ABI.
