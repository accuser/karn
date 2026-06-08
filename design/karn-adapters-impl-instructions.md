# Karn Adapters — Claude Code Implementation Instructions (v0.17)

Implementation plan for the first adapter increment. **Semantics are defined by
`design/karn-adapters-spec.md`** — this document is the *execution order*: what to
change, in which files, with which fixtures, and the gate at each step. Read the
spec first; where this plan and the spec disagree, the spec wins (and flag it).

Target version: **v0.17** (current tree is `0.16.0`). Bump all tooling versions
together at the end, as in prior increments.

---

## 0. Ground rules (do not skip)

- **Verify against the compiler, not the spec's prose.** The spec's emitted-TS
  snippets are *illustrative*. Before matching any `expected/`, confirm what the
  emitter actually produces, then bless and **read the diff** (`KARN_BLESS=1 cargo
  test -p karnc bless_positive_fixtures`). Blessing without reading is how a bug
  becomes the expected output — this project has been bitten by exactly that.
- **Additive.** Every existing fixture must still pass unchanged. v0.16 programs
  compile identically.
- **Definition of done, per increment** (`docs/src/contributing/testing.md`):
  positive **and** negative fixtures cover the feature and pass; emitted output
  passes the `tsc --strict` gate (`tests/tsc_verify.rs`); every new diagnostic code
  is registered in `diagnostics.rs`; **docs are updated in the same change**.
- **Green at every phase boundary**: `cargo test`, `cargo clippy -- -D warnings`,
  `cargo fmt --all --check`. Each phase below ends compilable and tested; treat
  each as its own commit (or PR), report results, and we fold findings back before
  the next.
- **Fixture numbering** starts at **positive `175`**, **negative `137`** (current
  frontier 174 / 136). Use `src/` + `expected/` (or `expected_error.txt`) project
  form; add `target.txt` = `workers` only when the test needs the Workers topology.
- **Negative fixtures** match by substring on `"{code} {message}"`, so
  `expected_error.txt` is usually just the diagnostic code.

### Explicitly DEFERRED — do not implement this increment

These are in the spec but **out of scope for v0.17** (the spec marks the locking
distinction "latent this increment" because the `karn` core ships no platform-native
capabilities):

- Platform-**locking** enforcement — `karn.target.vendor_required` /
  `karn.target.vendor_conflict`, effective-platform computation. No locking caps exist
  yet. (Wire the *concept* only where noted; enforce nothing.)
- **Vendor adapters** (`cloudflare`/`aws`), **env-backed** bindings, `wrangler.toml`
  binding generation.
- Decorate/wrap overrides; shared/singleton provider instances.
- Additional platforms (Node/Deno).
- [DECISION L] dependency-trust policy — implement only the minimal stub (§Phase 3):
  fold declared deps into `package.json`, reject unpinned ranges; no allow-list.

---

## Phase 1 — The `adapter` kind, external providers, and the placement discipline

**Goal.** Parse and type-check an `adapter` unit; emit its interfaces/types/exports;
emit **no** class for a bodiless (external) provider; enforce all placement rules.
No consumption wiring yet.

**Files.**

- `lexer.rs` / `keywords.rs` — add keywords `adapter` and `binding`
  (`k("adapter", …)`, `k("binding", …)`; `keywords.md` regenerates via `KARN_BLESS`).
- `ast.rs` — add `SourceUnit::Adapter(AdapterDecl)` (alongside `Commons`/`Context`/
  `Test`/`Integration`, ~`ast.rs:147`). `AdapterDecl` mirrors `Context` but its
  `items` are restricted (see checker) and it carries `binding: Option<BindingDecl>`
  and `uses`. Make `ProviderDecl.body` optional — model the body as
  `Option<Vec<ProviderOp>>` (or an explicit `ProviderBody { Karn(Vec<ProviderOp>),
  External }`); `None`/`External` = bodiless.
- `parser.rs` — top-level dispatch (the `commons`/`context` arms at ~`parser.rs:480–492`)
  gains an `adapter` arm → `parse_adapter_brace` / `parse_adapter_fragment` (clone the
  context parsers; restrict items). Parse `binding "<path>" requires { "pkg": "range",
  … }`. Parse bodiless `provides Cap = Name` (no brace block). Parse inline `fn`/`type`/
  `uses` inside an adapter (allowed — [B]).
- `checker.rs` / `project.rs` — adapter item validation and provider-placement rules.
- `emitter.rs` — `emit_provider` (`emitter.rs:1875`): when the provider is external,
  emit **nothing** (no class, no factory). Adapter capabilities/types/exports emit via
  the existing `emit_capability` (`emitter.rs:1844`) and type emitters unchanged.

**Rules / diagnostics** (register each in `diagnostics.rs`):

- `karn.adapter.provider_has_body` — a `provides Cap = X { … }` *with* a body inside an
  adapter.
- `karn.context.external_provider` — a bodiless `provides Cap = X` outside an adapter.
- `karn.adapter.disallowed_item` — a `service`, `agent`, or bodied provider inside an
  adapter (inline pure `type`/`fn`/`uses` are allowed).
- `karn.reserved_namespace` — any `commons`/`context`/`adapter`/`test` whose qualified
  name's **first segment** is `karn` (flat-name check on `QualifiedName.parts[0]`).
- `karn.adapter.no_binding` — an adapter declares ≥1 external provider but has no
  `binding` clause. (Symbol-level resolution is checked in Phase 2 / by tsc.)

**Fixtures.**

- Positive `175_adapter_declares_capability` — an adapter with a `binding` clause, a
  capability, a boundary `type`, an external provider, `exports capability`. Compiles;
  `expected/` shows the interface + token + exported types, **no provider class**.
- Negative `137_external_provider_in_context`, `138_bodied_provider_in_adapter`,
  `139_service_in_adapter`, `140_reserved_karn_name`, `141_adapter_missing_binding`.

**Done when.** The above fixtures pass; existing fixtures unchanged; fmt/clippy/test
green. (No consumer fixture yet — that needs Phase 2.)

---

## Phase 2 — Binding resolution and compose wiring

**Goal.** A consumer of an adapter capability (via the **existing v0.15 qualified**
`consumes U` + `given U.Cap`) compiles, and compose imports the external impl from the
adapter's binding module and injects it. `tsc --strict` passes against a hand-written
binding.

**Files.**

- `resolver.rs` — carry, per adapter, its binding module path (resolved **relative to
  the adapter's source file**) and the provider→symbol map.
- `project.rs` — binding resolution; surface `karn.adapter.no_binding` if the module is
  missing; fold `requires { … }` into the generated `package.json` (Phase 3 hardens the
  dep policy).
- `emitter/workers.rs` `compose` + `emitter.rs` (bundle compose) — where v0.12/v0.15
  instantiate a provider (`new ns.ProviderName()`, cf. fixture `170`'s `compose.ts`),
  an **external** provider instead emits `import { Sym } from "<binding module>"` and
  `new Sym(...)` into `deps`. Keep the `deps.<key>.op(...)` call lowering unchanged.

**Binding `.binding.ts` is an input**, not generated — the fixture author writes it
(see `tokens.binding.ts` in the spec §4.1). The compiler emits the import; `tsc` checks
the `implements` and the symbol's existence.

**Fixtures.**

- Positive `176_consume_adapter_qualified` (bundle) and `177_consume_adapter_workers`
  (`target.txt = workers`) — a library adapter + a context consuming it via
  `consumes U` / `given U.Cap`; author the `.binding.ts`; `expected/` shows compose
  importing and constructing the external impl. Must pass the `tsc` gate.

**Done when.** Both wire correctly and type-check under `tsc --strict`; the binding
import path is correct in both bundle and workers topologies.

---

## Phase 3 — `consumes U { Cap, … }` flattening, clash detection, dep stub

**Goal.** The bare-name DX: `consumes U { Clock, Logger }` → `given Clock` /
`Clock.now()`, resolving through the **local** capability path. Plus minimal dep
handling.

**Files.**

- `parser.rs` — extend `consumes-decl` with the `'{' name-list '}'` form (§3.3).
- `resolver.rs` — flatten each listed capability into the consumer's local
  `capability_info_map` under its bare name (this is the **net-new** resolution path;
  it does not exist in v0.15, which only resolved qualified `given U.Cap`).
- `checker.rs` / `project.rs` — bare-name resolution; clash detection
  (`karn.consumes.capability_name_clash`) when two flattened names collide or one
  clashes with a local capability. Reuse `karn.given.cross_context_unknown_capability`
  (`diagnostics.rs:240`) for "U doesn't export Cap".
- `project.rs` — **dep stub** for [DECISION L]: fold `requires` deps into
  `package.json`; **reject unpinned ranges** (e.g. `"*"`) with a clear error; no
  allow-list yet.

**Fixtures.**

- Positive `178_consume_braced_bare_names` — `consumes U { … }` + bare `given`/calls;
  emitted handler is byte-identical to a local-capability handler.
- Negative `142_consume_capability_clash`, `143_consume_unexported_cap`,
  `144_requires_unpinned_dep`.

**Done when.** Bare-name consumption emits the same handler code as a local capability;
clashes and unexported caps are rejected; unpinned deps are rejected.

---

## Phase 4 — The first-party `karn` surface (Clock, Random, Logger) + `--platform` stub

**Goal.** Ship the agnostic `karn` adapter and its Cloudflare binding inside the
toolchain; `consumes karn { … }` works end-to-end; the refined `Uuid` exercises the
§4.4 privileged-constructor rule.

**Files.**

- New first-party source embedded in the toolchain: the `karn` adapter
  (`Clock`/`Random`/`Logger`, `type Uuid = String where Matches("…")`,
  `Random.uuid() -> Effect[Uuid]`, canonical provider symbols `ClockProvider` etc.)
  and the binding `karn-cloudflare.ts` (`Date.now()`, `crypto.randomUUID()` via
  `Uuid.of(...)` + unwrap, `console.*`). Decide where toolchain-shipped units live and
  how they enter the unit table (mirror how `runtime.ts` is provisioned).
- `cli.rs` — add a **minimal** `--platform` flag, an enum with the single value
  `cloudflare` (default). It is *distinct* from `--target {bundle,workers}`
  (`CliTarget`, `cli.rs:22`) — do not conflate. It selects the `karn-<platform>.ts`
  binding; with one value it is effectively a stub, but the seam must exist.
- Reserved-prefix check (Phase 1) means user code cannot collide with `karn`.

**Fixtures.**

- Positive `179_consume_karn_clock_logger` (bundle) + `180_consume_karn_workers`
  (workers) — `consumes karn { Clock, Logger }`; compose injects the toolchain binding;
  `tsc` passes.
- Positive `181_karn_random_uuid_refined` — `Random.uuid()` returns refined `Uuid`; the
  binding constructs via `Uuid.of(crypto.randomUUID())` and unwraps the `Ok`; confirm
  the refined type round-trips and `tsc --strict` passes. This is the live test of the
  §4.4 discipline.

**Done when.** A context using only `karn` compiles and wires on cloudflare; the refined
`Uuid` path type-checks; `--platform` selects the binding without touching consumer code.

---

## Phase 5 — Library-adapter exemplars (`tokens`, `weather`)

**Goal.** Demonstrate user-authored library adapters with hand-written bindings, as
fixtures (these double as the docs' worked examples).

**Fixtures.**

- Positive `182_tokens_jose_adapter` — the spec §4.1 `tokens` adapter over `jose`
  (sum + record boundary types; the binding constructs via emitted constructors
  `Ok`/`Err` + `JwtError.Invalid`); `requires { "jose": "^5" }` reaches `package.json`;
  a consumer signs a token; `tsc` passes (stub the jose calls if needed so the gate is
  about shape, not runtime).
- Positive `183_weather_fetch_adapter` — the remote-API-over-`fetch` adapter; binding
  uses `fetch`, maps wire shape to `Result[Report, WeatherError]`; no npm dep.

**Done when.** Both compile and type-check; the bindings construct boundary values only
through emitted constructors (no raw `{ tag: … }` / `as` casts — §4.4).

---

## Phase 6 — Tooling and docs (land with the code, per definition-of-done)

- **tree-sitter** (`tree-sitter-karn/grammar.js`) — the `adapter` unit; the `binding`
  clause; bodiless `provides`; braced `consumes`. Add corpus cases; regenerate;
  validate fixtures parse clean.
- **vscode** (`vscode-karn` `tmLanguage`) — highlight `adapter`, `binding`. Bump version.
- **karn-fmt** (`fmt.rs`) — format `adapter` units, the `binding` clause, bodiless
  `provides`, and `consumes U { … }`; add idempotency fixtures.
- **karn-lsp** — `consumes ` autocompletes the `karn` surface and project adapters;
  inside `consumes U { … }` and at `given `, autocomplete exported capabilities; hover
  from contract doc blocks. (Locking-aware reporting is deferred.)
- **docs** (`docs/src/…`, regenerate reference pages with `KARN_BLESS`) — an "Adapters"
  reference (the three flavours, the `karn` surface, binding resolution, the
  privileged-constructor rule incl. the refined `.of` rule, the reserved `karn` prefix,
  per-deployment-unit locking *as a forward note*); a "Wrap a library as an adapter"
  how-to (the `tokens`/`weather` fixtures); troubleshooting entries for every new
  diagnostic; regenerate `grammar.md`, `diagnostics.md`, `keywords.md`.

**Done when.** Grammar/format/highlight all handle the new surface; docs build; the
generated reference pages include the new keywords and diagnostics.

---

## Diagnostics added this increment (register all in `diagnostics.rs`)

| Code | Phase | Severity |
|---|---|---|
| `karn.adapter.provider_has_body` | 1 | error |
| `karn.context.external_provider` | 1 | error |
| `karn.adapter.disallowed_item` | 1 | error |
| `karn.reserved_namespace` | 1 | error |
| `karn.adapter.no_binding` | 1/2 | error |
| `karn.consumes.capability_name_clash` | 3 | error |
| `karn.requires.unpinned_dependency` | 3 | error |

Reused: `karn.given.cross_context_unknown_capability` (`diagnostics.rs:240`).
**Not added this increment** (deferred): `karn.target.vendor_required`,
`karn.target.vendor_conflict`.

---

## Reporting back

After each phase, report: fixtures added/passing, any place the **actual emitter
output diverged from the spec's illustrative snippets** (these are the findings we fold
back into `design/karn-adapters-spec.md`), any rule that was awkward to express in the
existing AST/checker, and the `tsc`-gate result. Surprises in Phase 1 (placement rules)
and Phase 2 (binding import paths across bundle vs workers) are the most likely; the
refined-`Uuid` seam in Phase 4 is the deliberate stress point.
