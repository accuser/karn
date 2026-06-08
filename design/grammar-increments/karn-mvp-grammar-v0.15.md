# Karn v0.15 Grammar — Cross-Context Capability Resolution

A delta specification letting a context **provide a capability for other contexts
to consume**: context B declares and provides a capability and **exports** it; a
context A that `consumes B` can then `given B.Cap` in its handlers and providers,
and the composition root wires B's provider into A. This is the cross-context
extension of v0.12's intra-context provider composition, and the mechanism the
design notes describe for **platform / framework contexts** (Clock, Http, Random,
the first-party `Sagas`) — capabilities offered by one context and consumed as
ordinary `given` clauses by others.

Read the earlier specs first — `karn-mvp-grammar.md` through
`karn-mvp-grammar-v0.13.md` (v0.14 sagas is deferred), plus
`karn-type-system.md` §2.1.2 and the design notes §8 (bounded contexts,
provided/consumed capabilities) and §17 (deployment). The v0.15 compiler accepts
every prior program unchanged (the addition is additive: `exports capability`
and a qualified `given`).

This is a **design draft for review**. Choices marked **[DECISION]** are the
language-defining calls to settle before implementation. **§1.3 frames the
genuine design fork (the bundle/workers wiring model); please weigh in there
before approving.**

---

## 1. Scope

### 1.1 The gap

Capabilities are **context-local** today (v0.12): a `given Cap` must name a
capability declared in the *same* context, validated against a per-context map
(`karn.given.unknown_capability`, `project.rs:2951`). There is no way for a
context to use a capability another context provides — even though the design
notes make this central: "Application contexts consume [platform capabilities] by
declaring the capabilities they need" (§8), and first-party capabilities "live in
framework contexts that application contexts consume; their surfaces are ordinary
`given` clauses" (type-system §). Without this, every context must re-declare and
re-provide `Clock`, `Http`, etc.

### 1.2 The fix

A context **exports** a capability; a consumer `consumes` that context and uses
the capability via a **qualified `given`**:

```karn
context platform.time
capability Clock { fn now() -> Effect[Int] }
provides Clock = SystemClock { fn now() -> Effect[Int] { Effect.pure(0) } }
exports capability { Clock }

context orders
consumes platform.time
service api {
  on call() -> Effect[Int] given platform.time.Clock {
    let t <- platform.time.Clock.now()
    t
  }
}
```

The capability **contract** is imported for type-checking; the **provider** is
instantiated in the consumer's composition (§5).

### 1.3 The design fork — wiring model **(read before approving)** — [DECISION A]

A provided capability's provider has to run *somewhere* when A calls it. Two
models:

- **(A1) Local instantiation (recommended).** A's composition instantiates B's
  provider **in A** (bundle: in the shared root; workers: A's Worker imports B's
  provider class and constructs it locally). The capability call is an ordinary
  in-process method call (`deps.Clock.now()`), never crossing a Worker boundary.
  - *Fits* stateless platform capabilities (Clock, Http, Random) perfectly — each
    Worker has its own instance, exactly as the runtime intends.
  - *Cost:* B's provider code (and its transitive provider deps) is bundled into
    each consuming Worker. Acceptable — capabilities are shared contracts.
  - *Limit:* a capability whose provider needs B's **private agent state** can't
    be a simple local instance; such "stateful cross-context capabilities" route
    through an agent/service instead (out of scope — §1.4).

- **(A2) Remote routing.** A's capability call routes to B's Worker via a Service
  Binding (extending the `/_karn/call/` protocol to per-capability-op dispatch),
  so B's single provider instance serves all consumers.
  - *Fits* stateful shared capabilities; *costs* a network hop per capability call
    and a meaningful Service-Binding-protocol extension; *over-serves* the common
    stateless case.

**Recommendation: A1 (local instantiation).** It matches the platform-capability
model, keeps capability calls in-process, and reuses v0.12's provider
instantiation almost verbatim — the consumer simply instantiates a provider whose
*class* came from another context. A2 (remote) is the natural home for stateful
shared capabilities and pairs with the deferred sagas/coordination work.

### In scope for v0.15 (model A1)

- **`exports capability { … }`** — a context opts a capability into cross-context
  use ([DECISION B]).
- **Qualified `given B.Cap`** (and via a `consumes … as` alias) — a handler or
  provider depends on a capability another consumed context provides
  ([DECISION C]).
- **Cross-context capability type-checking** — the consumed capability's
  operation signatures are visible for `Cap.op(…)` calls.
- **Local provider instantiation** in the consumer's composition, bundle and
  workers, reusing v0.12's topological provider wiring across the boundary.

### 1.4 Out of scope (deferred)

- **Remote capability routing (A2)** and **stateful cross-context capabilities** —
  a provider needing another context's private agent state; these belong with the
  coordination/sagas work.
- **Re-providing / overriding** a consumed capability locally (a consumer
  swapping the provider) — beyond test mocks, which already exist.
- **Transitive capability re-export** — A consuming B's capability and re-exporting
  it to A's consumers; v0.15 resolves one hop.
- **Built-in platform capabilities** — v0.15 enables *user-written* platform/
  framework contexts; it ships no built-in `Clock`/`Http` (those can follow as
  ordinary library contexts).

---

## 2. The design at a glance

| | Intra-context (v0.12) | Cross-context (v0.15) |
|---|---|---|
| declare | `capability Cap { … }` in the context | same, in the **providing** context B |
| provide | `provides Cap = Impl { … }` | same, in B |
| expose | (implicit, local) | **`exports capability { Cap }`** in B |
| depend | `given Cap` | **`given B.Cap`** (B `consumes`-d) |
| wire | provider instantiated in this context's compose | B's provider instantiated **in the consumer's** compose (A1) |

The consumer must already `consumes B` (the behavioural-dependency edge);
`given B.Cap` requires it (`karn.consumes.*` otherwise).

---

## 3. Grammar

### 3.1 `exports capability`

```
exports-decl ::= 'exports' export-kind
export-kind  ::= visibility '{' name-list '}'        -- v0.4 type exports
               | 'capability' '{' name-list '}'      -- NEW v0.15
```

```karn
exports capability { Clock, Random }
```

A context lists the capabilities it offers to consumers. Each name must be a
capability the context **declares and provides** (§4).

### 3.2 Qualified `given`

```
given-clause ::= 'given' cap-ref (',' cap-ref)*
cap-ref      ::= identifier                 -- local capability (v0.12)
              | qualified-name '.' identifier  -- NEW: consumed-context capability
```

`given platform.time.Clock` (or, with `consumes platform.time as Time`, `given
Time.Clock`). A capability call uses the same prefix: `platform.time.Clock.now()`
/ `Time.Clock.now()`.

> Implementation note: `Handler.given` and `ProviderDecl.given` become `Vec<CapRef>`
> where `CapRef { context: Option<QualifiedNameOrAlias>, name: Ident }`
> (`ast.rs`), parsed in the existing `given` loops (`parser.rs`). A bare name is a
> local capability (unchanged); a dotted name is a cross-context reference.

---

## 4. Static semantics

### 4.1 `exports capability` validation

For `exports capability { C1, … }` in context B: each `Ci` must be a capability
**declared** in B (`karn.exports.undeclared_capability`) **and provided** in B
(`karn.exports.capability_not_provided` — a contract with no implementation can't
be resolved by a consumer). No duplicate exports; capabilities and types share the
`exports` clause but are distinct name kinds.

### 4.2 Cross-context `given` resolution

A `given B.Cap` (or `Alias.Cap`) in context A:

1. `B` (or the alias) must be a context A `consumes` (`karn.consumes.unknown_context`
   / the existing prefix resolution).
2. `Cap` must be a capability `B` **exports** (`karn.given.cross_context_unknown_capability`).
3. In the body, `B.Cap.op(…)` type-checks against `Cap`'s operation signatures
   (carried in a new `consumed_capabilities` map on `CrossContextInfo`, built like
   `consumed_services`).
4. The used-⊆-declared / declared-⊆-used discipline applies as for local
   capabilities.

A provider in A may also `given B.Cap` (v0.12 composition extended across the
boundary).

### 4.3 The cross-context provider graph

B's exported capability has a provider in B; that provider may itself `given`
other capabilities (B's own, or further cross-context ones). The consumer's
composition instantiates the provider and its dependency subgraph (the v0.12 topo
order, now spanning the imported providers). A cycle across contexts is rejected
(`karn.provider.dependency_cycle`, extended to the cross-context graph). Since the
`consumes` graph is already acyclic, cross-context capability edges follow it.

### Diagnostic codes

| Code | Status | Cause |
|---|---|---|
| `karn.exports.undeclared_capability` | new | `exports capability` names a non-capability / undeclared name |
| `karn.exports.capability_not_provided` | new | an exported capability has no provider in the context |
| `karn.given.cross_context_unknown_capability` | new | `given B.Cap` where B doesn't export `Cap` |
| `karn.given.unknown_capability` / `consumes.*` | reused | bare/unknown names, non-consumed context |

---

## 5. Compilation to TypeScript (model A1)

The consumer instantiates the consumed capability's provider locally, reusing
v0.12's provider class + constructor-injection machinery. The only new piece is
**importing the provider class from the providing context**.

- **Bundle mode.** The cross-context composition root already instantiates each
  context and wires consumed *surfaces* into deps. v0.15 additionally instantiates
  B's exported-capability providers (in topo order) and threads them into A's
  deps (`deps.Clock` for `given platform.time.Clock`, keyed by the local
  reference). B's provider class is already in the bundle.
- **Workers mode.** A's `compose(env)` instantiates B's provider locally —
  `import { SystemClock } from "../platform-time/handlers.js"; const Clock = new
  handlers_platform_time.SystemClock();` — and puts it in `deps`. The call
  `platform.time.Clock.now()` lowers to `deps.Clock.now()` (in-process; no Service
  Binding). B's provider code is bundled into A's Worker.
- **Call lowering.** `B.Cap.op(args)` / `Alias.Cap.op(args)` lowers to
  `deps.<localKey>.op(args)` exactly like a local capability call — the prefix is
  resolved away at lowering; the deps field is populated by composition.

**[DECISION A]** wiring model (A1 local vs A2 remote) — see §1.3. This section
specifies A1.

`tsc --strict` over the result is the gate (the imported provider class and its
deps object must type-check across the context boundary).

---

## 6. New test corpus

Fixture frontier: positive `166`, negative `128`. v0.15 starts at positive `167`,
negative `129`.

Positive:
```
167_cross_ctx_capability/        -- B exports Clock; A given platform.time.Clock  [+ bundle]
168_cross_ctx_capability_alias/  -- via `consumes B as T`, `given T.Clock`
169_cross_ctx_cap_in_provider/   -- A's provider `given B.Cap` (composition across boundary)
170_cross_ctx_capability_workers/-- the same, `--target workers` (local instantiation)  [workers]
```
Negative:
```
129_export_undeclared_capability/ -- `exports capability { Nope }`
130_export_capability_not_provided/ -- exported capability has no provider
131_given_cross_ctx_unknown/      -- `given B.Cap` where B doesn't export Cap
132_given_cross_ctx_not_consumed/ -- `given B.Cap` without `consumes B`
```

### Worked example

```karn
context platform.time

capability Clock { fn now() -> Effect[Int] }
provides Clock = SystemClock {
  fn now() -> Effect[Int] { Effect.pure(0) }
}
exports capability { Clock }

context ops.jobs
consumes platform.time

service tick {
  on call() -> Effect[Int] given platform.time.Clock {
    let t <- platform.time.Clock.now()
    t
  }
}
```

Exercises: `exports capability`; a qualified `given`; a cross-context capability
call; and local provider instantiation in `ops.jobs`'s composition (bundle and
workers).

---

## 7. Implementation notes

### 7.1 Where new code goes

| Area | File | Change |
|---|---|---|
| AST | `ast.rs` | `ExportsDecl` capability kind; `given` becomes `Vec<CapRef>` (handler + provider) |
| Parser | `parser.rs` | `exports capability { … }`; dotted names in `given` loops |
| Resolver | `resolver.rs` (`CrossContextInfo`) | new `consumed_capabilities: HashMap<ctx, HashMap<cap, CapabilityInfo>>`, built from each consumed context's exported capabilities |
| Checker | `project.rs:2951` / `checker.rs` capability-call resolution | resolve `B.Cap` in `given`; type-check cross-context `Cap.op`; new export/given diagnostics |
| Emitter (bundle) | `emitter.rs` composition root + deps | instantiate consumed providers, thread into consumer deps |
| Emitter (workers) | `emitter/workers.rs` `compose` | import B's provider class; instantiate locally; deps entry |
| Diagnostics | `diagnostics.rs` | the three new codes |

### 7.2 Risk areas

- **Provider class import across Worker dirs.** A's Worker imports B's provider
  from the sibling Worker dir; confirm the bundler includes it and `tsc --strict`
  resolves the import + the provider's deps object.
- **Topo order spanning contexts.** The provider graph now includes imported
  providers; the existing cycle check and topo sort must operate over the merged
  graph (still acyclic, following `consumes`).
- **Call-prefix resolution.** `platform.time.Clock.now()` vs `Time.Clock.now()`
  vs a local `Clock.now()` — the checker/emitter must resolve all three to the
  right deps key without ambiguity (a local capability shadows? — disallow a local
  name colliding with a consumed one, or qualify).
- **`exports capability` vs type exports** sharing one clause — keep the name
  kinds distinct in validation.

### 7.3 What "done" looks like

1. All prior fixtures pass (additive).
2. New fixtures pass; emitted output passes `tsc --strict` in both modes.
3. A consumer uses a provider-context's capability with no local re-declaration;
   the provider runs in-process.
4. `cargo test`, clippy, fmt clean; tooling + docs deltas land together.

---

## 8. Tooling delta (required)

- **tree-sitter** (`grammar.js`): `exports` gains a `capability` kind; the
  `given_clause` accepts dotted names. Add a v0.15 corpus case; regenerate;
  validate fixtures parse clean.
- **vscode** (`tmLanguage`): `capability` after `exports` already highlights as a
  keyword; dotted `given` names need no new scope. Bump the version.
- **karn-fmt** (`fmt.rs`): format `exports capability { … }` and dotted `given`
  refs; idempotency fixtures.

### 8.1 Generated grammar/keywords

`exports capability` reuses the existing `exports`/`capability` keywords (no new
keyword); regenerate `grammar.md`. No `keywords.md` change.

---

## 9. Documentation delta (required)

- **Reference** (`reference/capabilities.md`): a "cross-context capabilities"
  section — `exports capability`, qualified `given`, local provider instantiation;
  the platform/framework-context pattern.
- **How-to** (`how-to/capabilities/`): "Share a capability across contexts" (the
  §6 worked example: a platform-time context consumed by an app context).
- **Explanation** (optional): platform/framework contexts and why capabilities are
  ordinary `given` clauses across the boundary.
- **Troubleshooting**: pages for the new export/given diagnostics.
- **SUMMARY / changelog**; regenerate `diagnostics.md` + `grammar.md`; doc examples
  compile.

---

## 10. Decisions (resolved)

1. **[A] Wiring model — DECIDED: local instantiation (A1).** The consumer
   instantiates the provided capability's provider in its own composition (bundle
   root; workers Worker importing the provider class), keeping capability calls
   in-process. Reuses v0.12's provider machinery across the boundary.
2. **[B] Exposure — DECIDED: explicit `exports capability { … }`.** A context
   opts a capability into cross-context use.
3. **[C] Reference syntax — DECIDED: qualified `given B.Cap` / `Alias.Cap`.**
   Unambiguous, mirroring cross-context service-call qualification.
4. **[D] Scope — DECIDED: defer stateful cross-context capabilities and remote
   routing (A2)** to the post-MVP coordination/sagas work.

---

## 11. v0.16 preview

- **v0.16:** Multi-Worker integration testing — testing flows that span Workers
  (the consumer↔provider and consumer↔consumed-service edges this and earlier
  increments established), the MVP's final piece.

Deferred and revisited post-MVP: **v0.14 sagas / compensation** (and, with it,
remote capability routing A2 and stateful cross-context capabilities).
