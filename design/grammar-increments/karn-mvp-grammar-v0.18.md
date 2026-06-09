# Karn v0.18 Grammar — Adapter Dependencies & the Ambient Surface

The first of the two post-v0.17 adapter slices described in
`design/karn-adapters-spec.md` §13. This increment makes adapters *composable*:
an adapter may `consumes` another adapter's capabilities, and an external
provider's `given` clause is actually wired — compose builds the by-name deps
object and passes it to the binding class constructor. On top of that wiring,
the first-party `karn` surface gains its remaining ambient capabilities
(`Secrets`, `Fetch`), and the platform axis gains its second value
(`--platform node`).

Read first: `design/karn-adapters-spec.md` (§4.5 adapter-to-adapter
dependencies, [M] config-as-capability, [N] adapter `consumes` + external
`given`, [O] ambient surface scope), and v0.15 (cross-context capabilities)
for the flattening machinery this reuses.

> **The two-slice split.** The adapters spec packed this wiring, the
> `cloudflare` platform adapter (`Kv`, `Queue`), env/`wrangler.toml`
> derivation, and platform-lock enforcement into one "v0.18". That increment
> is now split: **this doc is the wiring + ambient slice (v0.18)**; the
> platform adapter and lock enforcement (`karn.target.vendor_required`,
> `karn.target.vendor_conflict`) are **v0.19**. §7.3 lists what this slice
> deliberately leaves in place for v0.19.

---

## 1. Scope

### 1.1 The gap

v0.17 shipped adapters, but they are islands:

- **An adapter cannot depend on anything.** `AdapterDecl` has no `consumes`,
  so a `tokens` adapter that should fetch a JWKS key or read a secret has no
  way to name those capabilities. Config and IO leak into operation
  parameters instead — `Jwt.sign(claims, secret)`, `Weather.current(url, key)`
  — the exact wart spec decision [M] exists to remove.
- **External providers are constructed no-arg.** `provides Jwt = JwksJwt
  given Fetch` *parses* today (the v0.17 parser accepts `given` on external
  providers), but the external branch of `instantiate_provider_expr`
  short-circuits to `new ns__binding.JwksJwt()` and the `given` refs fail
  resolution because adapters get no cross-context info.
- **The ambient surface is incomplete.** `Clock`, `Random`, `Logger` shipped;
  `Secrets` and `Fetch` ([O]) did not — so no library adapter can reach the
  network or configuration through a capability.
- **The platform axis is vacuous.** `--platform` accepts only `cloudflare`,
  so nothing platform-keyed can be observed to vary, and v0.19's
  `vendor_required` diagnostic would have no second platform to fire against.

### 1.2 The fix

Four additive moves, one per gap:

1. **Adapter `consumes`** — `consumes karn { Fetch, Secrets }` inside an
   adapter, braced form only, adapter targets only (§3.1, §4.1).
2. **External-provider `given` wiring** — compose resolves each `given` name
   through the provider's own unit's flattened-capability map, instantiates
   the depended-on providers (recursing through other adapters' bindings),
   and passes the by-name deps object to the binding constructor (§5).
3. **`karn.Secrets` + `karn.Fetch`** on the first-party surface (§3.2), with
   a `node`-and-`cloudflare`-portable contract.
4. **`--platform node`** — a `karn-node.ts` first-party binding nearly
   identical to the cloudflare one; the platform axis becomes real (§5.4).

### 1.3 In scope / out of scope

**In scope:** the adapter `consumes` clause; external-provider `given`
wiring in both `bundle` and `workers` targets; `karn.Secrets` / `karn.Fetch`
+ both platform bindings; `--platform node`; revision of the
`tokens`/`weather` exemplar fixtures to config-as-capability; two new
diagnostics; tree-sitter/fmt/docs deltas.

**Out of scope (v0.19):** the `cloudflare` platform adapter (`Kv`, `Queue`);
typed `Env` resource fields and `wrangler.toml` stanza derivation;
platform-lock recording and the `karn.target.vendor_required` /
`karn.target.vendor_conflict` diagnostics (not registered this increment —
the registry gate demands docs for registered codes); shared/singleton
provider instances; decorate/wrap overrides.

---

## 2. The design at a glance

| Move | Surface | Mechanism |
|---|---|---|
| Adapter deps | `consumes U { Cap, … }` in an adapter | reuses v0.15/v0.17 flattening verbatim |
| External `given` | `provides Jwt = JwksJwt given Fetch, Secrets` | compose passes `{ Fetch, Secrets }` deps object to the binding ctor |
| Ambient additions | `consumes karn { Fetch, Secrets }` | new contracts in the synthetic `karn` adapter; per-platform providers |
| Platform axis | `--platform {cloudflare,node}` | selects `karn-cloudflare.ts` / `karn-node.ts` |

The binding author's contract: `constructor(private deps: { Fetch: Fetch;
Secrets: Secrets })` — keys are the `given` names, checked by the `tsc
--strict` gate. Nothing positional.

---

## 3. Grammar

### 3.1 Adapter `consumes`

```
adapter-item ::= binding-decl | capability-decl | provider-decl
               | type-decl | fn-decl | uses-decl | exports-decl
               | consumes-decl                                   -- NEW
```

The `consumes-decl` production is unchanged from v0.17; what is new is its
admission into the adapter body, with two restrictions enforced
semantically (§4.1):

- **braced form only** — an adapter has no services to RPC-call, so the
  whole-unit and `as Alias` forms are meaningless inside one;
- **adapter targets only** — adapter dependencies are adapter-to-adapter
  (spec §4.5); an adapter consuming a *context* is rejected.

```karn
adapter tokens {
  binding "./tokens.binding.ts" requires { "jose": "^5" }
  consumes karn { Secrets }                 -- NEW: adapter-level dependency

  exports capability  { Jwt }
  exports transparent { Claims, JwtError }

  type Claims   = { sub: String, exp: Int }
  type JwtError = enum { Invalid, Expired }

  capability Jwt {
    fn sign(claims: Claims) -> Effect[String]
    fn verify(token: String) -> Effect[Result[Claims, JwtError]]
  }

  provides Jwt = JoseJwt given Secrets      -- external provider with deps
}
```

No new keywords; no parser change beyond the adapter-body item set. The
external-provider `given` clause already parses in v0.17.

### 3.2 The ambient additions — `karn.Secrets`, `karn.Fetch`

Added to the synthetic first-party `karn` adapter source:

```karn
type Method     = enum { Get, Post, Put, Delete }
type FetchError = enum { Network, Timeout }
type Request  = { method: Method, url: String, contentType: Option[String],
                  authorization: Option[String], body: Option[String] }
type Response = { status: Int, body: String }

capability Fetch   { fn send(req: Request) -> Effect[Result[Response, FetchError]] }
capability Secrets { fn get(name: String) -> Effect[Option[String]] }

provides Fetch   = FetchProvider
provides Secrets = SecretsProvider
```

> **[DECISION C — recorded]** The spec sketched `headers: List[Header]`.
> Karn has **no sequence type** (`TypeRef` supports `Result`/`Option`/
> `Effect`/`HttpResult` generics, records, and `enum` sums only), so the
> v0.18 `Request` carries the two headers the MVP exemplars need
> (`contentType`, `authorization`) as `Option[String]` fields. A general
> header list is **deferred until Karn grows a sequence type**; widening
> `Request` later is additive.

---

## 4. Static semantics

### 4.1 Adapter `consumes` validation

For `consumes U { C1, … }` in an adapter: identical to the context rules
(target exists and is consumable; each `Ci` exported by `U`; bare names
flattened into the unit's local capability namespace; clashes rejected) —
the same code path, extended to adapter units. Two adapter-only rules:

- a whole-unit or aliased `consumes` in an adapter →
  `karn.adapter.consumes_requires_selection`;
- a context target → `karn.adapter.consumes_context`.

Adapter→adapter cycles are caught by the existing consumes-cycle detection,
which runs over the unit-consumes graph generically (its message wording
generalises from "contexts" to "units").

### 4.2 External-provider `given` resolution

An external provider's `given` refs are validated exactly as a bodied
provider's are: each bare name must be a local capability or a flattened
consumed one; prefixed names resolve through the consume prefix. This works
by building cross-context info for adapter units (v0.17 built it for
contexts only) — no new validation code.

A capability on the `karn` surface may not depend on a platform-native one
(spec [O]); with no platform adapter until v0.19 this is vacuous now and
enforced then.

### Diagnostic codes

| Code | Status | Cause |
|---|---|---|
| `karn.adapter.consumes_requires_selection` | new | whole-unit or aliased `consumes` inside an adapter |
| `karn.adapter.consumes_context` | new | an adapter `consumes` a context |
| `karn.given.unknown_capability` | reused | external `given X` with no local/flattened `X` |
| `karn.given.cross_context_unknown_capability` | reused | `consumes U { Cap }` where `U` doesn't export `Cap` |
| `karn.consumes.capability_name_clash` | reused | flattened bare-name collision in an adapter |
| `karn.context.consumes_cycle` | reused | adapter→adapter consume cycles |

---

## 5. Compilation to TypeScript

### 5.1 The resolution rule

For each `given` ref of a provider, a **bare** name resolves through the
**provider's own unit's** flattened-capability map (e.g. `Fetch` → `karn`),
falling back to the unit itself; a **prefixed** name resolves through the
consume prefix as today. The recursion then instantiates each dependency
from *its* unit — external providers from that unit's binding module
(`{unit}__binding`), bodied providers from the unit namespace.

This rule also fixes a latent v0.17 gap: a *context's* bodied provider
`given Fetch`, with `Fetch` flattened from `consumes karn { Fetch }`,
mis-wired before (bare names never consulted the flattened map).

### 5.2 Bundle target

Scenario: `context auth.sessions` consumes `tokens { Jwt }`; `adapter
tokens` consumes `karn { Secrets }`, `provides Jwt = JoseJwt given Secrets`.

```ts
// compose.ts (generated)
import * as karn__binding from "./karn-cloudflare.js";
import * as tokens__binding from "./tokens.binding.js";

const auth_sessionsDeps = {
  Jwt: new tokens__binding.JoseJwt({
    Secrets: new karn__binding.SecretsProvider(),
  }),
};
```

`karn__binding` is imported although **no context** consumes `karn`: the
compose's binding-import set is the **transitive closure** of adapter
`consumes` edges reachable from the contexts' consumed adapters (the
closure walk is a reusable helper — it is the lock-propagation walk v0.19
needs).

### 5.3 Workers target

Same shape per-Worker, with binding imports at the out root and `env`
passed to flagged first-party providers:

```ts
// workers/auth-sessions/compose.ts (generated)
import * as karn__binding from "../../karn-cloudflare.js";
import * as tokens__binding from "../../tokens.binding.js";

export interface Env {
}

export function compose(env: Env) {
  const Jwt = new tokens__binding.JoseJwt({
    Secrets: new karn__binding.SecretsProvider(env),
  });
  ...
}
```

`Env` stays empty — a consumed adapter produces no Service Binding in
either target (v0.17 invariant, unchanged).

> **[DECISION B — recorded] env source for `Secrets`.** First-party
> metadata flags env-taking providers (v0.18: only `SecretsProvider`). Both
> platforms' `SecretsProvider` take `constructor(private env?: unknown)`
> with lookup order *explicit env → `(globalThis as any).process?.env`*.
> The workers compose (which already receives `env`) passes it; the bundle
> compose passes nothing — the `globalThis` probe covers bundle-under-node
> honestly without an `@types/node` dependency. `unknown` rather than
> `Record<string, string>` because the emitted workers `Env` interface has
> no index signature. `Clock`/`Random`/`Logger` stay no-arg, so v0.17
> compose output is unchanged for them.

### 5.4 `--platform node`

`Platform::Node` joins the enum; the toolchain links `karn-node.ts` — near
identical to `karn-cloudflare.ts` (global `crypto`/`fetch` on Node ≥ 18; the
`SecretsProvider` reads `process.env` via the same `globalThis` probe, never
bare `process`). The compose is platform-identical; only the imported
binding module differs — exactly the conformance-surface claim of spec §4.2,
now observable.

---

## 6. New test corpus

Positive (`karnc/tests/fixtures/positive/`):

| # | Fixture | Proves |
|---|---|---|
| 184 | `adapter_consumes_adapter` | two user adapters; external provider `given` wired in bundle compose |
| 185 | `adapter_given_workers` | same shape under `--target workers` |
| 186 | `karn_fetch_secrets` | context consumes `karn { Fetch, Secrets }`; new `karn.ts`/`karn-cloudflare.ts` text |
| 187 | `karn_secrets_workers` | `SecretsProvider(env)` in a worker compose |
| 188 | `karn_node_platform` | `platform.txt` = node; `karn-node.ts` emitted |
| — | context bodied-provider with flattened `given` | regression for the latent v0.17 gap (§5.1) |

Revised in place: `182_tokens_jose_adapter` (drops `secret: String` params;
`consumes karn { Secrets }`), `183_weather_fetch_adapter` (`given Fetch,
Secrets`; URL/key via capabilities). The v0.17 no-consumes adapter shape
stays covered by 175–177.

Negative (`karnc/tests/fixtures/negative/`): 145 whole-unit consumes in
adapter; 146 adapter consumes a context; 147 external `given` with unknown
capability; 148 adapter consume cycle; 149 `consumes karn { Nope }` in an
adapter.

Tree-sitter corpus: `test/corpus/v0.18.txt` — adapter `consumes` (braced) +
external provider `given`, combined.

---

## 7. Implementation notes

### 7.1 Where new code goes

| Area | File | Change |
|---|---|---|
| AST | `ast.rs` | `AdapterDecl.consumes: Vec<ConsumesDecl>` |
| Parser | `parser.rs` | `Consumes` arm in `parse_adapter_body` (reuses `parse_consumes_decl`) |
| Project | `project.rs` | `ParsedFile::consumes()` covers adapters; adapter branch of the consumes pass; cross-context info for adapters; `instantiate_provider_expr` consults `unit_flattened` + external deps object; `adapter_given_closure` import helper |
| Emitter (workers) | `emitter/workers.rs` | inline deps expression for external cross-cap providers; closure-driven binding imports; `env` to flagged first-party ctors |
| First-party | `firstparty.rs` | `Fetch`/`Secrets` contracts; `FetchProvider`/`SecretsProvider` in both bindings; `Platform::Node` + `KARN_NODE_BINDING`; `provider_takes_env` |
| CLI | `cli.rs` | `CliPlatform::Node` |
| Formatter | `fmt.rs` | `format_adapter_body` prints `consumes` (between `binding` and `uses`) |
| Diagnostics | `diagnostics.rs` | the two new codes |
| Test harness | `tests/e2e.rs` | `platform.txt` fixture marker → `compile_project_with_platform` |
| tree-sitter | `grammar.js` | `$.consumes_decl` in `_adapter_body_item` |

### 7.2 Risk areas

- **The deps recursion across binding namespaces** — a `given` dep may live
  in *another* adapter's binding; the namespace renderer differs between
  bundle (`{ns}__binding`) and workers (`../../` imports). One shared core,
  two renderers.
- **Transitive binding imports** — missing the closure means a compose that
  references `karn__binding` without importing it; tsc catches it, but the
  closure must drive both targets' import sets.
- **Fixture churn in 179–181** — `karn.ts`/`karn-cloudflare.ts` grow new
  decls; the Clock/Random/Logger compose lines must stay byte-identical.
- **Binding-side global shadowing** — `Request`/`Response` shadow DOM/Workers
  globals inside binding modules; first-party bindings import them aliased.
- **`process` access under tsc** — only via `(globalThis as any).process?.env`;
  bare `process` would demand `@types/node` in the gate.

### 7.3 Leave-behinds for v0.19

`Platform` enum ready for more variants; `provider_takes_env` metadata is
the hook env/resource derivation extends; `adapter_given_closure` is the
lock-propagation walk; `emit_wrangler_toml` untouched as the stanza
derivation point; `vendor_required`/`vendor_conflict` reserved (spec §5).

### 7.4 What "done" looks like

1. Prior fixtures pass; 179–181 differ only by the grown `karn` modules.
2. An adapter `consumes karn { Secrets }` with `provides X = Y given
   Secrets` compiles in both targets; the binding receives `{ Secrets }`;
   workers passes `env` to `SecretsProvider`.
3. `182`/`183` exemplars take no config params; their bindings receive
   capabilities.
4. `--platform node` emits `karn-node.ts`; compose otherwise identical.
5. The five negative fixtures fire the right codes.
6. Emitted output passes `tsc --strict`; `cargo test` / clippy / fmt clean;
   karn-fmt roundtrip and tree-sitter corpus green.

---

## 8. Tooling & docs delta (required)

- **tree-sitter / karn-fmt**: adapter-body `consumes`; corpus + roundtrip
  via the fixture corpus. **vscode**: no change (keywords already present).
- **karn-lsp**: no change expected — flattened-cap completion is shared;
  verify no hardcoded adapter-item lists.
- **Docs**: `reference/adapters.md` gains adapter `consumes`, the
  deps-object binding contract, the grown ambient table (+ List deferral
  note), and the platforms section; changelog entry; regenerate
  `diagnostics.md`, `grammar-appendix.md`, `cli.md` (new `--platform`
  value) via `KARN_BLESS`.
- **Version**: workspace 0.17.0 → 0.18.0 (root `Cargo.toml` incl. the
  `karnc` dep pin, `vscode-karn/package.json`,
  `tree-sitter-karn/package.json`).

---

## 9. Decisions

1. **[A] Adapter `consumes` form** — ▸ braced form only, adapter targets
   only; two new diagnostics. Relaxing either later is additive.
2. **[B] env source for `Secrets`** — ▸ optional-ctor-param + `globalThis`
   probe; workers passes `env`, bundle passes nothing (§5.3).
3. **[C] `Fetch` contract shape** — ▸ minimal typed core; named optional
   header fields; `List[Header]` deferred until Karn has a sequence type
   (§3.2).
4. **[D] Cycle handling** — ▸ reuse the existing consumes-cycle detection;
   no adapter-specific mechanism.
