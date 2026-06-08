# Karn v0.12 Grammar — Provider Composition (`provides … given`)

A delta specification letting a **provider depend on other capabilities** — a
`provides` block may declare a `given` clause and call other capabilities in its
operation bodies. The composition root wires the resulting dependency graph. This
turns capabilities from a flat set of leaf implementations into a *composed*
graph, which is what real adapters need (a `Payments` provider that uses `Http`
and `Logger`; an `Orders` provider that uses `Clock` and `Idempotency`).

Read the earlier specs first — `karn-mvp-grammar.md` through
`karn-mvp-grammar-v0.11.md`, plus `karn-runtime-spec.md`. The v0.12 compiler
accepts every v0–v0.11 program unchanged; all prior fixtures must continue to
pass (the addition is an optional `given` clause on `provides`).

This is a **design draft for review**. Choices marked **[DECISION]** are the
language-defining calls to settle before implementation.

---

## 1. Scope

### The problem

A `capability` is a behavioural contract; a `provides` block implements it
(`provides Logger = ConsoleLogger { fn log(…) { … } }`). Today a provider's
operation bodies are checked with **no capabilities in scope** — the checker
passes an empty capability map to provider bodies (`project.rs:2815`+), so a
provider **cannot use another capability**. That forbids the most common real
shape: an adapter built *from* other adapters.

```karn
-- today: impossible — a provider can't reach Logger
provides Payments = StripePayments {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
    Logger.info("charging")   -- ERROR: Logger not in scope here
    …
  }
}
```

### The fix — `provides … given`

A `provides` block gains an optional `given` clause, exactly like a handler. Its
operation bodies may then use the listed capabilities; the composition root wires
each provider's dependencies when it instantiates it.

```karn
provides Payments = StripePayments given Http, Logger {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
    let _   <- Logger.info("charging")
    let res <- Http.post("/charge", amount)
    …
  }
}
```

### In scope for v0.12

- **`given` on `provides`** — a provider declares the capabilities its bodies use
  (§3); the same used-⊆-declared / declared-⊆-used discipline as handlers (§4).
- **The capability dependency graph** — providers form a graph over capabilities;
  the composition root instantiates them in dependency order (§5).
- **Cycle rejection** — a capability that (transitively) depends on itself is a
  compile error (§4, [DECISION B]).
- The worked example: a `Payments` provider composed from `Http` + `Logger` (§6).

### Out of scope (deferred)

- **Multiple providers per capability / provider selection** (`@dev` / `@prod`
  layering) — v0.12 keeps **one provider per capability** per context; choosing
  among alternatives is a later concern.
- **Parameterised providers** (`provides X = Factory(level: String) { … }`) —
  construction still takes no value arguments; configuration-from-`env` is
  separate.
- **Cross-context provider wiring** — a provider depending on a capability
  *provided by another context* is **v0.15** (cross-context capability
  resolution). v0.12 composes within a single context's capabilities.
- **Effect-free providers as commons** — providers remain context-only; commons
  stay pure (no `provides`, no `given`).

---

## 2. The design at a glance

| Before (v0.11) | After (v0.12) |
|---|---|
| `provides Cap = Impl { … }` — body sees no capabilities | `provides Cap = Impl given C1, C2 { … }` — body may use `C1`, `C2` |
| every provider is a leaf | providers form a capability dependency graph |
| compose: `new Impl()` for each, any order | compose: instantiate in dependency order, injecting each provider's deps |
| capability calls only in handlers | capability calls in handlers **and** provider bodies |

Capability *calls* are unchanged at the source level (`Logger.info(…)`), and
unchanged at handler call sites in the emitted code; only the provider gains a
constructor that receives its dependencies (§5).

---

## 3. Updated grammar

### 3.1 `given` on `provides`

```
provider-decl ::= doc-block? 'provides' capability-name '=' provider-name
                  given-clause? '{' provider-op+ '}'

given-clause  ::= 'given' identifier (',' identifier)*
```

The `given` clause sits between the provider name and the body, mirroring its
position on a handler. No other grammar change; `provider-op` (a `fn name(params)
-> T { body }`) is unchanged.

```karn
provides Payments = StripePayments given Http, Logger {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
    let _ <- Logger.info("charging")
    …
  }
}
```

> Implementation note: `ProviderDecl` (`ast.rs:299`) gains `given: Vec<Ident>`;
> `parse_provider_decl` (`parser.rs:3282`) parses the optional clause after the
> provider name; both forms keep parsing the `{ … }` body unchanged.

---

## 4. Updated static semantics

### 4.1 Provider `given` validation

A provider's `given` clause is checked exactly as a handler's (the existing
`karn.given.*` rules, reused):

1. Each name in `given` must be a capability declared in the context
   (`karn.given.unknown_capability`).
2. A capability call inside a provider body must be one the provider listed in
   `given` (`karn.given.undeclared_capability`) — concretely: provider bodies are
   now checked with their `given` capabilities in scope (the empty map at
   `project.rs:2815`+ becomes the provider's capability set), instead of none.
3. A `given` capability never used in the provider's bodies is a warning
   (`karn.given.unused_capability`).

Provider bodies remain effectful (they already implement `Effect`-returning ops),
so capability use (`<-`, `Cap.op(…)`) is permitted exactly as in handlers.

### 4.2 The capability dependency graph & cycles — **[DECISION B]**

Each capability `C` provided in the context has a provider; that provider's
`given` lists the capabilities `C` depends on. This induces a directed graph over
the context's capabilities. v0.12 **rejects a dependency cycle**
(`karn.provider.dependency_cycle`): a capability cannot, directly or transitively,
depend on itself, because the composition root cannot instantiate a cycle in
dependency order.

```
provides A = ImplA given B { … }
provides B = ImplB given A { … }   -- error: A → B → A
```

**[DECISION B]** Reject cycles (**recommended** — a capability that depends on
itself is almost always a design error, and the graph is built anyway to order
composition) vs. allow them via lazy wiring (each provider holds the whole deps
object and resolves dependencies at call time). Recommend **reject**: it is the
cleaner-typed wiring (§5) and surfaces a real smell.

### 4.3 Self-provision

A provider may **not** list its own capability in `given` (`provides Logger =
… given Logger`) — that is the trivial one-node cycle, caught by the same rule.

### Diagnostic codes

| Code | Status | Cause |
|---|---|---|
| `karn.given.unknown_capability` | reused | a provider `given` names a non-existent capability |
| `karn.given.undeclared_capability` | reused | a provider body calls a capability not in its `given` |
| `karn.given.unused_capability` | reused | a provider `given` capability is never used (warning) |
| `karn.provider.dependency_cycle` | **new** | providers form a capability dependency cycle |

---

## 5. Compilation to TypeScript — **[DECISION A]**

A provider that depends on other capabilities must still **conform to its
capability's interface** (its methods match `interface Logger { log(message):
… }`). So the dependencies cannot be threaded as an extra method parameter
(that would break the interface). The recommended wiring is **constructor
injection in topological order**:

- A provider with `given` gets a **constructor** taking its dependencies; its
  operation bodies lower capability calls to the injected deps (e.g.
  `this.deps.Logger.info(…)`), while the methods keep the capability's exact
  signature.
- The composition root instantiates providers in **dependency order** (a topo
  sort of the §4.2 graph), passing each its dependencies:

```typescript
// compose(env), workers mode — providers in dependency order:
const Logger = new handlers.ConsoleLogger();                    // no deps
const Http   = new handlers.FetchHttp();                        // no deps
const Payments = new handlers.StripePayments({ Http, Logger }); // deps injected
const deps = { Logger, Http, Payments, env };
return { /* surface — unchanged */ };
```

- **Handler call sites are unchanged**: `Logger.info(…)` in a handler still
  lowers to `deps.Logger.info(…)`. Only provider *bodies* use the injected
  `this.deps.…`, and only providers with `given` gain a constructor.

**[DECISION A]** Constructor injection + topological order (**recommended** —
keeps capability interfaces exact, leaves every existing capability-call site
untouched, standard DI) vs. deps-threading (every provider method takes a
trailing `deps`, made optional so it still satisfies the interface; no topo sort,
tolerates cycles, but re-blesses every existing capability-call fixture and
loosens the interface). Recommend **constructor injection**.

> Implementation note: provider bodies need a lowering mode where a capability
> call resolves to `this.deps.<cap>` rather than `deps.<cap>` — a small variant
> of the existing handler lowering (`emitter.rs:3229`+). The topo sort lives in
> the compose emitters (`emitter/workers.rs:66`+ and the bundle `makeSurface`),
> reusing the §4.2 graph. Bundle and workers modes both order the same way.

No runtime-library change. `tsc --strict` over the result is the gate (the
injected-deps types must line up).

---

## 6. New test corpus

Fixture frontier: positive `159`, negative `122`. v0.12 starts at positive `160`,
negative `123`.

### Positive

```
160_provider_given_basic/     -- a provider using one other capability
161_provider_dep_chain/       -- A given B given C (a 3-deep chain)
162_provider_unused_given/    -- declared-but-unused given on a provider (warning)
163_full_payment_composed/    -- the §6 worked example                    [workers]
```

### Negative

```
123_provider_undeclared_cap/  -- provider body calls a capability not in its given
124_provider_given_unknown/   -- provider given names a non-existent capability
125_provider_dependency_cycle/ -- A given B, B given A
126_provider_self_given/      -- provides X = … given X
```

### Worked example: a composed payment provider

```karn
context commerce.payment

uses commerce.money

type AuthId = opaque String where Matches("AUTH-[0-9]{8}")
type PaymentError = enum { Declined, GatewayDown }

capability Logger { fn info(message: String) -> Effect[()] }
capability Http   { fn post(path: String, amount: Money) -> Effect[Result[AuthId, PaymentError]] }

provides Logger = ConsoleLogger {
  fn info(message: String) -> Effect[()] { Effect.pure(()) }
}

provides Http = FetchHttp {
  fn post(path: String, amount: Money) -> Effect[Result[AuthId, PaymentError]] {
    Ok(AuthId.unsafe("AUTH-12345678"))
  }
}

-- Payments is *composed* from Http + Logger:
capability Payments { fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] }

provides Payments = StripePayments given Http, Logger {
  fn authorise(amount: Money) -> Effect[Result[AuthId, PaymentError]] {
    let _      <- Logger.info("charging")
    let result <- Http.post("/charge", amount)
    result
  }
}

service authorise {
  on call(amount: Money) -> Effect[Result[AuthId, PaymentError]] given Payments {
    let r <- Payments.authorise(amount)
    r
  }
}
```

Exercises: a provider with `given`; capability calls inside a provider body; the
dependency graph (`Payments → {Http, Logger}`); topological composition; and a
handler that uses only the top-level `Payments` capability while the provider
graph supplies the rest.

---

## 7. Implementation notes

### 7.1 Where new code goes (file:line anchors)

| Area | File | Change |
|---|---|---|
| AST | `ast.rs:299` (`ProviderDecl`) | add `given: Vec<Ident>` |
| Parser | `parser.rs:3282` (`parse_provider_decl`) | parse optional `given` after the provider name |
| Provider body check | `project.rs:2815`+ | pass the provider's `given` capability set (not `HashMap::new()`) into `check_handler_body`; validate `given` against declared capabilities |
| Dependency graph + cycles | `project.rs` (provider collection ~`:1991`) | build the capability graph from provider `given`s; reject cycles (`karn.provider.dependency_cycle`) |
| Diagnostics | `diagnostics.rs` | add `karn.provider.dependency_cycle` |
| Provider emission | `emitter.rs:1789`+ | emit a constructor for providers with `given`; lower provider-body capability calls to `this.deps.<cap>` |
| Compose / makeSurface | `emitter/workers.rs:66`+ and bundle `makeSurface` (`emitter.rs:2071`+) | instantiate providers in topological order, injecting each one's deps |

### 7.2 Risk areas

- **Interface conformance.** The provider class must still satisfy the capability
  interface; constructor injection keeps method signatures exact (don't add
  `deps` to the methods).
- **Topological order in both targets.** Bundle (`makeSurface`) and workers
  (`compose`) must order providers identically; share the sort.
- **Provider-body lowering.** Capability calls in a provider body resolve to the
  injected deps (`this.deps.…`), not the ambient handler `deps`. Keep the two
  lowering contexts distinct.
- **Unused-given warning parity.** A provider's unused `given` is a warning, same
  as a handler's — don't let it become an error.
- **`tsc --strict`.** The injected-deps object type for each provider must list
  exactly its `given` capabilities.

### 7.3 What "done" looks like

1. All v0–v0.11 fixtures pass (regression — `given` on `provides` is optional, and
   existing capability-call emission is unchanged under [DECISION A]).
2. New fixtures pass (4 positive, 4 negative); emitted output passes `tsc
   --strict`.
3. A composed provider's dependencies are wired in topological order and its body
   calls them.
4. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean.
5. Tooling delta (§8) and docs delta (§9) land in the same commit.

---

## 8. Tooling delta (required)

- **tree-sitter** (`grammar.js`): the `provider_decl` rule gains an optional
  `given_clause` between the provider name and the body (the `given_clause` rule
  already exists for handlers — reuse it). No new keyword. Add a v0.12 corpus
  case; validate all fixtures parse to zero ERROR/MISSING.
- **vscode** (`karn.tmLanguage.json`): no change (`given` already highlights);
  bump the extension version.
- **karn-fmt** (`fmt.rs`): the provider formatter prints the optional `given`
  clause (mirroring the handler `given` formatting). Add an idempotency fixture.

---

## 9. Documentation delta (required)

- **Reference** (`docs/src/reference/`): document `provides … given` — a provider
  may depend on other capabilities; the dependency graph and cycle rule; how
  composition orders providers. (Extend the capabilities/providers reference, or
  add one if absent.)
- **How-to**: a "Compose a provider from other capabilities" recipe (the §6
  payment example).
- **Explanation** (optional): a short note on the capability dependency graph and
  why composition is constructor injection.
- **Troubleshooting**: a page for `karn.provider.dependency_cycle`.
- **SUMMARY.md / changelog**; regenerate `diagnostics.md`, `grammar.md`,
  `keywords.md`; every fenced `karn` block compiles via the doc-example gate.

---

## 10. Decisions (resolved)

1. **[A] Wiring — DECIDED: constructor injection + topological order.** A provider
   with `given` gets a constructor taking its dependencies; the composition root
   instantiates providers in dependency order. Capability interfaces stay exact
   and every existing capability-call site is unchanged. Provider bodies lower
   capability calls to the injected `this.deps.<cap>`.
2. **[B] Cycles — DECIDED: reject.** A capability dependency cycle is a compile
   error (`karn.provider.dependency_cycle`); the topo sort cannot order a cycle.
3. **[C] One provider per capability — DECIDED: keep.** v0.12 keeps the
   single-provider rule; provider selection / layering is deferred.

---

## 11. v0.13+ preview

After v0.12, capabilities compose within a context. The roadmap continues:

- **v0.13:** Refinement narrowing.
- **v0.14:** Sagas / compensation.
- **v0.15:** Cross-context capability resolution — a provider (or handler)
  depending on a capability **another context** provides; the natural extension
  of v0.12's intra-context graph across context boundaries.
- **v0.16:** Multi-Worker integration testing.

Provider *selection* (alternative implementations chosen at build/config time) and
*parameterised* providers slot in wherever configuration-driven wiring next earns
its keep; they build on the single-provider graph v0.12 establishes.
