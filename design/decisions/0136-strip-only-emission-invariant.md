# 0136 — The emitter's output is strip-only: every emitted `.ts` is erasable by pure type-stripping

- **Status:** Accepted (in-browser track, slice 0; v0.108).
- **Provenance:** the first slice of the in-browser track, which front-loads the
  enabling work for an in-browser REPL/playground. The strip-only invariant is the
  lowest layer: it is what lets `bynkc` produce runnable JS — and lets the browser
  run emitted code — without a TypeScript compiler in the loop. It also repairs a
  latent inconsistency on the existing `bynkc test --inspect` path, which runs the
  emitted `.ts` directly under Node `--experimental-strip-types`.
- **Relation to prior records:** complements [ADR 0104](0104-debug-launch-model.md)
  (the `--inspect` debug build runs emitted `.ts` under strip-only Node) by making
  strip-cleanliness a guaranteed property of the *whole* emitted surface, not an
  ad-hoc property of individual modules. Leaves TypeScript-first output unchanged
  ([ADR 0016](0016-no-portable-infrastructure.md), and the design notes' §19
  commitment): TS stays the primary artefact; this invariant only constrains *how*
  the emitter spells that TS.

## Context

Node's type-stripping (`--experimental-strip-types`, and the `node:module`
`stripTypeScriptTypes` API it is built on) erases type syntax by replacing it with
whitespace. It cannot erase **type-directed** constructs that imply runtime code —
constructor **parameter properties** (`constructor(private x: T) {}`, which
synthesise `this.x = x`), `enum`, and `namespace` with values. On those it throws
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. `tsc` accepts all of them, so the existing
`tsc --strict --noEmit` gate over emitted output (the `emitted_typescript_passes_tsc_strict`
test) does **not** catch them.

bynk already runs emitted `.ts` under strip-only Node on the `--inspect` debug path
(ADR 0104), and the in-browser track needs to run emitted code in the browser with
no transpiler. Both require that the emitter never produce a type-directed
construct. An audit found four such constructs, all parameter properties:

1. the provider `given`-injection constructor in the emitter
   (`bynk-emit/src/emitter/emit.rs`): `constructor(private deps: { … }) {}`;
2–4. the `SecretsProvider`/`WorkersKv` constructors in the three shipped first-party
   bindings (`bynk-{cloudflare,node}.ts`, `cloudflare.binding.ts`):
   `constructor(private env?: unknown) {}`.

The emitted `AssertionError` test-scaffold class had already been de-sugared
(it carries a comment citing ADR 0104); the four above had not. The bindings in
particular silently broke any `--inspect` debug session that exercised `Secrets`
(or a `given`-clause provider), because the module fails to parse under strip-only
Node before any breakpoint can bind.

## Decision

**The emitter emits only TypeScript that pure type-stripping can erase — across its
entire output surface, including the first-party platform bindings.** This is a
standing invariant, not a per-target branch.

- The provider `given` constructor is de-sugared **unconditionally** to a declared,
  typed field plus an assigning constructor:

  ```ts
  private deps: { … };
  constructor(deps: { … }) { this.deps = deps; }
  ```

  Under the emitted ES2022 tsconfig, `useDefineForClassFields` is on: the field
  declaration defines `this.deps` at construction and the body then assigns the
  real value; the end state is identical to a parameter property, the field stays
  typed for the `tsc`/strict path, and the form strips to
  `constructor(deps) { this.deps = deps; }`. The rewrite *removes* the one
  type-directed site in the emitter rather than adding a branch.

- The three shipped bindings adopt the same declared-field + assigning-constructor
  shape for their `env`/`deps` constructors.

- A regression test makes the invariant **load-bearing**: every `.ts` emitted for
  the project-form positive fixtures (emitter output, the shipped bindings, the
  embedded runtime, and any user binding copied into a fixture) is checked with
  `node:module`'s `stripTypeScriptTypes(code, { mode: 'strip' })` — the precise
  strip-only oracle, run once over the whole staged tree. `node
  --experimental-strip-types --check` is deliberately *not* used: a file that leads
  with a `type`/`declare` statement trips its module detection and false-fails even
  though it strips cleanly.

## Consequences

- `bynkc`'s emitted output runs unchanged under strip-only Node, so the `--inspect`
  debug path is correct for `given`-clause providers and `Secrets`, and the in-browser
  track can run emitted code without a transpiler.
- The invariant **forbids future type-directed emitter constructs** (parameter
  properties, `enum`, `namespace`, decorators) permanently. This is a real
  constraint on emitter authors; the regression test turns any violation into a
  failing build rather than a latent runtime break on the debug/browser paths.
- The de-sugared forms are byte-for-byte reflected in the fixture `expected/`
  snapshots, so the form is pinned by the existing snapshot comparison as well.
- TypeScript-first output is untouched: the emitted TS still type-checks under
  `tsc --strict`, and the de-sugared fields remain fully typed.
