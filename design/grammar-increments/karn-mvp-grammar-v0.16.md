# Karn v0.16 Grammar — Multi-Worker Integration Testing

The MVP's final increment. Every prior increment built a *piece* of a multi-context
system and tested it **in isolation** (v0.7 unit tests, with consumed contexts and
capabilities replaced by `mocks`). v0.16 adds the missing test kind: an
**integration test** that wires several contexts together **as the Workers they
actually deploy as** and exercises a flow **end-to-end across the Worker
boundary** — real providers, real cross-context service calls, real serialisation.

This is what closes the loop. v0.6 gave cross-context service calls; v0.9/workers
gave per-context Worker bundles with a `/_karn/call/` Service-Binding protocol;
v0.15 gave cross-context capabilities. All three established **edges that only
exist at the Worker boundary** — and *nothing in the test layer exercises that
boundary*. A v0.7 unit test of `commerce.orders` mocks `commerce.payment`, so the
serialise → JSON → deserialise → structural-projection → refinement-revalidation
path (the code workers-mode emits and bundle-mode never runs) is **completely
untested**. v0.16 tests exactly that path.

Read the earlier specs first — `karn-mvp-grammar.md` through `…-v0.13.md` and
`…-v0.15.md` (v0.14 sagas is deferred), plus the runtime spec (`karn-runtime-spec.md`)
and design notes §17 (deployment). The v0.16 compiler accepts every prior program
unchanged; the addition is a new **top-level test kind** and a CLI extension.

This is a **design draft for review.** Choices marked **[DECISION]** are the
language-defining calls to settle before implementation. **§1.3 frames the genuine
fork — the execution-fidelity model — please weigh in there before approving.**

---

## 1. Scope

### 1.1 The gap

Today `karnc test`:

- Compiles the whole project in **`bundle`** mode (`main.rs` `run_test`,
  `BuildTarget::Bundle`).
- Every cross-context call in a test is either (a) a **mock** (`mocks Payment =
  …`, the common case — the consumed context is replaced wholesale), or (b) in the
  rare un-mocked case, an **in-process function call** through the bundle
  composition root.

Neither path executes the multi-Worker wire. In `bundle` mode, `Alias.svc(args)`
lowers to `deps.surface.<key>.svc(args)` — a direct call with a cast through
`unknown` (`emitter.rs` `cross_context_lowering_prefix`). The workers-mode lowering
— `callService(env.<BINDING>, "svc", serialise_args(...), deserialise_Result(...))`
crossing `POST /_karn/call/svc` (`emitter/workers_entry.rs`, runtime `callService`)
— is emitted, type-checked by `tsc --strict`, and **never run by any test**. So:

- **Serialisation round-trips are unverified.** A type whose `serialise_T` /
  `deserialise_T` disagree, or a structural-projection mismatch across the
  boundary, passes every unit test and `tsc`, and fails only in production.
- **Boundary error handling is unverified.** `BoundaryError`
  (MalformedJson / StructuralMismatch / RefinementViolation / Transport) and the
  `/_karn/call/` 400/500 mapping have no test coverage.
- **Cross-Worker agent (Durable Object) calls are unverified.** The
  `callDurableObjectMethod` / `makeWorkersAgent` path over `/_karn/agent/<method>`
  is emitted but never exercised end-to-end.

"It type-checks in workers mode" is the only guarantee we have for the most
failure-prone surface in the system. The MVP should not ship without a way to test
a real multi-Worker flow.

### 1.2 The fix

A new top-level declaration — the **integration test** — names a set of
participating contexts, stands each one up **as its own (in-process) Worker** with
its **real** providers and surfaces, wires their Service Bindings and
Durable-Object namespaces together, and runs test cases that call **entry
services by qualified name**. Cross-context calls between participants travel the
**real wire** (serialise → JSON → deserialise), so the boundary is under test.

```karn
test integration "checkout" {
  wires commerce.orders, commerce.payment

  uses commerce.money

  test "small order places and authorises across the wire" {
    let r <- commerce.orders.place(Money.fromMinorUnits(5000, "USD"))
    assert r is Ok(_)
  }
}
```

`commerce.orders.place(...)` enters the `orders` Worker; inside, `orders` calls
`commerce.payment.authorise(...)` — and *that* call crosses a simulated Service
Binding that performs the real JSON round-trip into the `payment` Worker.
No mocks; both contexts run their production code.

### 1.3 The design fork — execution-fidelity model **(read before approving)** — [DECISION A]

An integration test has to *run* the cross-Worker boundary somehow. Three models,
in increasing fidelity and cost:

- **(M1) In-process, real surfaces, no wire.** Build the participants with the
  **bundle** composition root (real providers/surfaces, no mocks) and call across
  them as in-process functions. *Tests the integrated **logic**; does **not**
  exercise serialise/deserialise/projection.* — This is almost what an un-mocked
  bundle test already does; it does **not** close the gap in §1.1, so it is **not**
  enough on its own.

- **(M2) Simulated wire, in Node (recommended).** Compile the participants in
  **workers** mode (the real `compose(env)`, `/_karn/call/` dispatch, serialise/
  deserialise helpers, DO classes). Generate a harness that stands each Worker up
  as an in-process object and wires its `env`: every Service Binding is a stub
  whose `.fetch(req)` calls the **target participant's real `fetch`**, and every
  Durable-Object namespace is a stub backed by the existing `InMemoryStorage` /
  DO-class dispatch. Entry calls and inter-participant calls both travel the real
  serialise → `JSON.stringify` → `JSON.parse` → deserialise path.
  - *Tests* exactly the §1.1 gap (wire format, boundary errors, cross-Worker agent
    calls) — the code that only workers-mode emits.
  - *Reuses* the entire workers-mode runtime almost verbatim
    (`callService`, the entry dispatch, `serialise_*`/`deserialise_*`,
    `makeWorkersAgent`, `InMemoryStorage`). The genuinely new code is the **env
    graph harness** + **DO-namespace stubs**.
  - *Runs* in plain Node + `tsc`, exactly like today's `karnc test` — **no new
    external dependency** (no `wrangler`, no `miniflare`).
  - *Limit:* it simulates the binding; it is not the actual `workerd` runtime, so
    Cloudflare-specific runtime quirks aren't caught. Acceptable — those belong to
    a deploy-time check, not the language's MVP test layer.

- **(M3) Real runtime via miniflare / `wrangler dev`.** Spin up the actual Workers
  runtime with real Service Bindings and Durable Objects. Highest fidelity; needs
  `miniflare` as a dependency, a heavier/slower harness, and a runtime the rest of
  `karnc test` deliberately avoided (the v0.7 spec chose "plain Node.js … no
  Workers runtime needed"). **Out of scope** — a post-MVP option.

**Recommendation: M2 (simulated wire).** It is the first model that actually tests
multi-Worker flows (M1 doesn't), it reuses the workers-mode emission we already
ship and `tsc`-verify, it keeps `karnc test` on plain Node with no new dependency,
and it matches every prior increment's "runnable, verified by `tsc --strict`"
discipline. M3 is the natural post-MVP fidelity upgrade and pairs with a future
deploy/`workerd` story.

> The rest of this spec specifies **M2**.

### In scope for v0.16 (model M2)

- **`test integration "<name>" { … }`** — a new top-level test kind ([DECISION B]).
- **`wires <ctx>, <ctx>, …`** — the participating contexts, stood up as Workers
  ([DECISION C, E]).
- **Entry calls by qualified name** — `commerce.orders.place(args)` (service) and
  `commerce.orders.Cart(key).add(args)` (agent), from the harness root, reusing
  v0.6's cross-context call checking ([DECISION D]).
- **Real cross-Worker execution** of inter-participant service calls, cross-context
  capability wiring (local per A1), and cross-Worker agent calls — all through the
  workers-mode emission and a generated in-process env graph.
- **`karnc test`** discovers integration tests alongside unit tests and runs both.

### 1.4 Out of scope (deferred)

- **M3 / real `workerd`** and any `miniflare`/`wrangler` dependency.
- **Mocks inside an integration test.** The point is real wiring; mocking belongs
  to v0.7 unit tests. (Edge-mocking of a non-participant consumed context is
  [DECISION C]; the recommendation defers it — see §4.2.)
- **HTTP-route entry** (`on http`) as an integration entry point — deferred to a
  follow-up; v0.16 enters through services and agents (the v0.6/agent edges the
  preview names). Queue/cron entry likewise deferred.
- **Fault injection** (forcing a `Transport` boundary error, dropped messages,
  partial failure) — post-MVP, pairs with sagas/compensation.
- **Parallel test execution / state seeding** — still v0.7's constraints.

---

## 2. The design at a glance

| | Unit test (v0.7) | Integration test (v0.16) |
|---|---|---|
| targets | one commons/context | a **set** of contexts (`wires …`) |
| consumed contexts | **mocked** (`mocks …`) | **real**, run as sibling Workers |
| cross-context call | mock method / in-process | **real wire** (serialise → JSON → deserialise) |
| build mode | `bundle` | **`workers`** (+ in-process env graph) |
| entry | service in scope by name | **qualified** `ctx.service(args)` / `ctx.Agent(k).m(args)` |
| what it proves | a unit's logic, in isolation | a flow **across Workers**, integrated |
| runs on | Node + tsc | Node + tsc (no new dep) |

Unit tests and integration tests are complementary and coexist; `karnc test` runs
both.

---

## 3. Grammar

### 3.1 The integration-test declaration

```
top-level-decl   ::= commons-decl | context-decl | test-decl | integration-decl   -- NEW

integration-decl ::= doc-block? 'test' 'integration' string-literal '{' integration-body '}'
                   | doc-block? 'test' 'integration' string-literal integration-body  -- fragment form

integration-body ::= wires-decl integration-item*

wires-decl       ::= 'wires' qualified-name (',' qualified-name)+        -- ≥ 2 participants

integration-item ::= uses-decl | test-case
```

- `test integration "<name>"` — `integration` is a **contextual keyword** after
  `test` (it is not reserved elsewhere; `integration` remains a valid identifier),
  mirroring how `state`/`on`/`given` are contextual ([DECISION B]).
- `wires` is a **new reserved keyword**. The `wires` clause is **required** and
  lists **≥ 2** participating contexts (one participant is a unit test's job).
- `uses` brings commons into the test bodies (for constructing arguments), exactly
  as in unit tests.
- The body holds `test "<case>" { … }` cases (§3.2). **No `mocks`** (§4.2).
- The string-literal name identifies the suite in runner output and the emitted
  module filename.

```karn
test integration "checkout" {
  wires commerce.orders, commerce.payment, platform.time
  uses commerce.money

  test "place small order authorises payment across the wire" {
    let r <- commerce.orders.place(Money.fromMinorUnits(5000, "USD"))
    assert r is Ok(_)
  }
}
```

### 3.2 Test cases and entry calls

A test case is the v0.7 `test "<name>" { block }` (the body has implicit type
`Effect[Result[(), AssertionError]]`; `assert expr` and the full statement/
expression grammar apply). The new ingredient is **how a case reaches into a
participant** — by qualified name, since the case body sits *outside* every
context:

```
entry-service-call ::= qualified-name '(' arg-list? ')'          -- commerce.orders.place(args)
entry-agent-call   ::= qualified-name '(' expr ')' '.' ident '(' arg-list? ')'
                                                                 -- commerce.cart.Cart(id).add(item)
```

These reuse the existing **cross-context call** AST + checker path (v0.6
`check_cross_context_call`) and the agent-call path, with the harness root acting
as a consumer of every participant ([DECISION D]). The leading qualified name must
be a participant in `wires`; the called service/agent-handler must be one the
participant **exports / declares**, checked exactly as a cross-context call is.

### 3.3 New keyword

```
wires
```

`wires` joins the reserved set. `integration` is contextual (only special directly
after `test`). `test`, `assert`, `uses` are unchanged.

---

## 4. Static semantics

### 4.1 Integration-test validation

For `test integration "<name>" { wires C1, C2, … ; cases }`:

1. Each `Ci` must resolve to a declared **context** (not a commons, not a test) in
   the project (`karn.integration.unknown_participant`).
2. **≥ 2** participants; duplicates are an error
   (`karn.integration.duplicate_participant`).
3. **Closure** — every context **transitively consumed** by a participant must
   **itself be a participant** (`karn.integration.unwired_dependency`, with a note
   naming the missing context). An integration test runs *real* Workers; a consumed
   context that is not wired has no Worker to route to. ([DECISION E] — closure
   required, not auto-added.)
4. Suite names are unique across the project
   (`karn.integration.duplicate_suite`); case names unique within a suite (reuses
   the v0.7 duplicate-case check).

### 4.2 No mocks; real wiring

An integration test body may **not** contain `mocks` (`karn.integration.mock_in_integration`
— with a note pointing to unit tests for mocking). Participants are wired with
their **real** providers (local), real cross-context capabilities (local
instantiation per v0.15 A1, the provider hosted in the consumer Worker), and real
Service Bindings between participant Workers.

> **[DECISION C]** Edge-mocking (mocking a consumed context that is deliberately
> *not* a participant) is **deferred**: §4.1.3 requires full closure, so there is
> no un-wired edge to mock in v0.16. Revisit if a participant consumes something
> genuinely external (e.g. a future built-in `Http`); the MVP has no built-in
> external capabilities, so the closed world is deterministic.

### 4.3 Entry-call type-checking

Each `Ci.service(args)` / `Ci.Agent(key).handler(args)` in a case body is checked
as a **cross-context call from the harness root** to participant `Ci`:

- The harness root is treated as consuming **all** participants (so the existing
  prefix-resolution + `consumed_services` / agent-surface machinery applies).
- Arguments are checked for **structural compatibility** against the participant's
  signature (v0.6 `structurally_compatible`); return types are **rebranded** into
  the test body's view (v0.6 `rebrand_return_type`) so `assert r is Ok(_)` etc.
  type-check.
- The case body is the v0.7 `Effect[Result[(), AssertionError]]` block; `<-`, `?`,
  `assert`, `match`, `is` all apply unchanged.

### 4.4 The participant Worker graph

The set of participant Workers, with Service-Binding edges along the `consumes`
graph (already acyclic — `karn.workers.dependency_cycle` still applies) and
Durable-Object namespaces for each participant's agents. Building this graph reuses
the workers-mode composition (`emit_worker_compose`, `Env` interface) per
participant; v0.16 adds the **harness** that supplies a concrete `env` binding each
stub to a sibling participant (§5).

### Diagnostic codes

| Code | Status | Cause |
|---|---|---|
| `karn.integration.unknown_participant` | new | `wires` names a non-context |
| `karn.integration.too_few_participants` | new | `wires` lists < 2 contexts |
| `karn.integration.duplicate_participant` | new | a context listed twice in `wires` |
| `karn.integration.unwired_dependency` | new | a transitively-consumed context is not a participant |
| `karn.integration.duplicate_suite` | new | two `test integration` with the same name |
| `karn.integration.mock_in_integration` | new | `mocks` inside an integration test |
| `karn.cross_context.*`, `karn.workers.dependency_cycle` | reused | entry-call resolution / cycle |

---

## 5. Compilation to TypeScript (model M2)

An integration test compiles to one module, `out/tests/integration_<name>.test.ts`,
that (a) imports each participant's **workers-mode** `compose`/`handlers`/DO
classes, (b) builds an **in-process env graph**, and (c) runs the cases.

### 5.1 The env graph harness (the one new runtime piece)

For participants `C1 … Cn`, the harness builds, per participant, an `env`
satisfying that participant's generated `Env` interface (`emit_worker_compose`):

- **Service Binding stub.** For each binding `Ci → Cj`, `env_i[<BINDING_j>] = {
  fetch: (req) => __dispatch_Cj(req, env_j) }`, where `__dispatch_Cj` is `Cj`'s
  Worker `fetch` (the `/_karn/call/` dispatcher emitted by
  `emit_worker_entry`, refactored to a callable `dispatch(request, env)` — see
  §7.1). The request/response are real `Request`/`Response` objects with
  JSON bodies — the **same wire `callService` already speaks**.
- **Durable-Object namespace stub.** For each agent in `Ci`, `env_i[<DO_BINDING>]`
  is a stub whose `idFromName(k)`/`get(id)` return a DO stub whose `.fetch(req)`
  routes to a **single in-memory instance** of the emitted DO class
  (constructed with an `InMemoryStorage`-backed `DurableObjectState`, reusing the
  runtime helpers). Same key → same instance for the duration of a case (so state
  accumulates within a case; fresh per case — §5.3).

A small new runtime helper, `makeIntegrationEnv(participants)` (added to
`runtime.ts`), assembles this graph from a declarative description the emitter
generates (binding name → target dispatch; DO binding → DO class). Everything it
wires already exists; it only connects them in-process.

### 5.2 Entry calls

`Ci.service(args)` in a case lowers to the **workers `callService`** against the
harness env for `Ci` — `callService(env_root.<BINDING_Ci>, "service",
serialise_args(...), deserialise_Result_…)` — i.e. the harness root holds a binding
to every participant and calls in exactly as a Worker would. `Ci.Agent(key).m(args)`
lowers through the workers agent path (`makeWorkersAgent` over the DO stub). The
boundary is therefore exercised on **entry** too, not just between participants.

### 5.3 Isolation

Per the v0.7 model: a fresh env graph per **case** (new `InMemoryStorage`, new DO
instances, so agent state starts empty and does not leak between cases); sequential
execution; mocks N/A.

### 5.4 Runner integration

`karnc test` (`main.rs run_test`):

1. Compiles the project **twice** when integration tests are present: `bundle`
   (for unit tests + production output, as today) and **`workers`** (participant
   modules the integration harness imports). The workers output lands under
   `out/workers/…` exactly as `karnc compile --target workers` produces it; the
   integration module imports from there.
2. Emits `out/tests/integration_<name>.test.ts` per suite, and aggregates their
   `run()` into the existing `out/tests/main.ts`.
3. `tsc -p out/tsconfig.json` (extended to include `out/workers` + the integration
   modules), then `node out-js/tests/main.js` — unchanged execution path.

Output reuses the v0.7 runner format, with integration suites grouped under their
name:

```
integration · checkout:
  ✓ place small order authorises payment across the wire
  ✓ declined payment surfaces as PaymentDeclined

2 passed, 0 failed.
```

`tsc --strict` over the whole thing (including `out/workers`) is the gate — the
integration module type-checks against the **real** workers-mode interfaces.

---

## 6. New test corpus

Fixture frontier: positive `170`, negative `132`. v0.16 starts at positive `171`,
negative `133`.

Positive:
```
171_integration_two_context_service/   -- wires orders, payment; entry service call across the wire
172_integration_with_capability/       -- a participant uses a wired context's exported capability (A1)
173_integration_with_agent/            -- entry agent call; state accumulates within a case, resets across
174_integration_full_checkout/         -- worked example: orders ↔ payment ↔ platform.time, multiple cases
```
Negative:
```
133_integration_unknown_participant/   -- wires commerce.nope
134_integration_too_few_participants/  -- wires commerce.orders   (only one)
135_integration_unwired_dependency/    -- wires orders but not the payment it consumes
136_integration_mock_in_integration/   -- mocks inside test integration
```

> Slicing note (per increment discipline): if 173/agent + DO-stub work proves
> large, land **v0.16a** (service edge: 171/172 + negatives) first, then
> **v0.16b** (agent edge: 173/174) — mirroring the v0.10a/b precedent. One version
> number, two landable commits.

### Worked example (174)

```karn
test integration "checkout" {
  wires commerce.orders, commerce.payment, platform.time
  uses commerce.money

  test "small order authorises and places" {
    let r <- commerce.orders.place(Money.fromMinorUnits(5000, "USD"))
    assert r is Ok(_)
  }

  test "amount over the limit is declined end-to-end" {
    let r <- commerce.orders.place(Money.fromMinorUnits(900000, "USD"))
    match r {
      Err(PaymentDeclined) => assert true
      _                    => assert false
    }
  }
}
```

Exercises: `wires` with 3 participants; closure (orders consumes payment which uses
platform.time's `Clock`); real serialise/deserialise across the orders→payment
binding; return-type rebranding so `PaymentDeclined` matches; and the runner
grouping. The same flow a v0.7 unit test could only check with `mocks Payment` now
runs against payment's **real** service over the wire.

---

## 7. Implementation notes

### 7.1 Where new code goes

| Area | File | Change |
|---|---|---|
| Lexer | `lexer.rs` | reserve `wires`; `integration` recognised contextually after `test` |
| AST | `ast.rs` | `SourceUnit::Integration(IntegrationDecl)`; `IntegrationDecl { name, participants, uses, cases, form, … }` |
| Parser | `parser.rs` | `parse_integration_*` (brace + fragment); `wires` clause; reuse `parse_test_case` |
| Resolver | `resolver.rs` | register suites; resolve participants; build the harness-root `CrossContextInfo` (consumes all participants) |
| Checker | `project.rs` / `checker.rs` | §4 validations; entry-call checking via `check_cross_context_call` with the harness root; closure check over `unit_consumes` |
| Emitter | `project.rs` (`emit_integration_module`) | the integration module: import workers modules, build env-graph description, lower cases, `run()` |
| Emitter (refactor) | `emitter/workers_entry.rs` | extract the `/_karn/call/` + agent dispatch into a callable `dispatch(request, env)` the harness can invoke (entry `index.ts` calls it too — no behaviour change) |
| Runtime | `emitter.rs` `RUNTIME_TS` | `makeIntegrationEnv(...)` + DO-namespace stub helpers (in-memory) |
| CLI | `main.rs` `run_test` | second (workers) compile when integration tests present; extend tsconfig include; aggregate into `tests/main.ts` |
| Diagnostics | `diagnostics.rs` | the six new `karn.integration.*` codes |

### 7.2 Risk areas

- **Dispatch refactor.** Extracting `dispatch(request, env)` from `index.ts` must
  be behaviour-preserving for the real entry point (verified by the existing
  workers fixtures 117–121, 137, 170 staying green). This is the load-bearing
  reuse: the harness must call the **same** dispatcher production uses.
- **DO-namespace stubs.** The trickiest new runtime: `idFromName`/`get`/`.fetch`
  must route to a stable in-memory DO instance per key, with `InMemoryStorage`
  state, matching `callDurableObjectMethod`'s expectations. Lean on the existing
  `StateRegistry` / `makeTestState` helpers (already used by unit-test agents).
- **Two-mode compile cost.** `karnc test` compiling both bundle and workers when
  integration tests exist — keep the workers output scoped to participants and
  cache; ensure tsconfig includes both trees without double-emitting `runtime.ts`.
- **Return-type rebranding at the harness root.** The root consumes every
  participant; ensure `rebrand_return_type` resolves names into the *test body's*
  view consistently when two participants export same-named types.
- **`integration` as a contextual keyword.** Confirm `integration` stays usable as
  an ordinary identifier elsewhere (a field, a commons name) — only special right
  after `test`.

### 7.3 What "done" looks like

1. All prior fixtures pass (additive; workers fixtures unchanged by the dispatch
   refactor).
2. New fixtures pass; the integration modules + `out/workers` pass `tsc --strict`;
   `node` runs the integration suites green (and a deliberately-failing assertion
   reports informatively).
3. A flow spanning ≥ 2 real Worker participants executes across the simulated wire
   — serialise/deserialise actually run — with no mocks.
4. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean; tooling
   + docs deltas land together.

---

## 8. Tooling delta (required)

- **tree-sitter** (`grammar.js`): add the `integration` test form — `test
  integration <string> { wires …; test … }`; reserve `wires`; `integration`
  highlights as a keyword only after `test`. Add a v0.16 corpus case; regenerate;
  validate fixtures parse clean.
- **vscode** (`tmLanguage`): `integration` (after `test`) and `wires` as keywords;
  bump the version.
- **karn-fmt** (`fmt.rs`): format `test integration "<name>" { … }`, the `wires`
  clause (one line; wrap on overflow), and qualified entry calls; idempotency
  fixtures.
- **karn-lsp**: `wires` participants resolve to context definitions (go-to-def);
  hover on an entry call shows the participant service signature. (Reuse the
  cross-context hover path.)

### 8.1 Generated grammar/keywords

`wires` is a new keyword → regenerate `keywords.md` and `grammar.md`.
`test integration` reuses `test`.

---

## 9. Documentation delta (required)

- **Reference** (`reference/testing.md`): a "Multi-Worker integration tests"
  section — `test integration`, `wires`, entry calls, real-wire semantics, the
  no-mocks rule, isolation.
- **How-to** (`how-to/testing/integration.md`): "Test a flow across Workers" — the
  §6 worked checkout example, end to end, with `karnc test` output.
- **Explanation** (`explanation/`): unit vs integration — what each proves, why the
  boundary needs its own test layer (the §1.1 argument).
- **Troubleshooting**: pages for the six new `karn.integration.*` diagnostics.
- **SUMMARY / changelog**; regenerate `diagnostics.md`, `keywords.md`, `grammar.md`;
  doc examples compile (`karn` blocks; negatives tagged `karn,fail`, pseudo-syntax
  `karn,ignore`).

---

## 10. Decisions (to resolve)

1. **[A] Execution-fidelity model — RECOMMEND M2 (simulated wire in Node).**
   M1 doesn't test the boundary; M3 (miniflare) is post-MVP and adds a dependency.
   M2 runs the real serialise/deserialise/dispatch in plain Node, reusing
   workers-mode emission. *(§1.3.)*
2. **[B] Declaration syntax — RECOMMEND `test integration "<name>" { wires … }`**,
   `integration` contextual after `test`, `wires` reserved. Reuses the `test`
   introducer and `test "<case>"` cases. *(§3.)*
3. **[C] Mocking in integration tests — RECOMMEND none** (full closure, real
   wiring; mocking stays in v0.7 unit tests). *(§4.2.)*
4. **[D] Entry addressing — RECOMMEND qualified `ctx.service(args)` /
   `ctx.Agent(k).m(args)`**, checked as cross-context calls from a harness root.
   *(§3.2, §4.3.)*
5. **[E] Participant set — RECOMMEND explicit `wires` + required closure**
   (error on an unwired transitive dependency, rather than silently auto-adding).
   *(§4.1.)*
6. **[F] Slicing — RECOMMEND v0.16a (service edge) then v0.16b (agent edge)** if
   the DO-stub work is large; otherwise land as one. *(§6.)*

---

## 11. After v0.16 — the MVP is complete

v0.16 is the **final MVP increment**. With it, Karn can write, compose, deploy
(bundle + workers), and **test across the deployment boundary**. What remains is
deliberately post-MVP:

- **v0.14 sagas / compensation** (deferred by design) — and, with it, **fault
  injection** in integration tests, **remote capability routing (A2)**, and
  **stateful cross-context capabilities**.
- **M3 real-runtime integration testing** (miniflare/`workerd`) and a dev server.
- **HTTP/queue/cron entry points** for integration tests.
- The broader **v1 surface** (events, query algebra, storage-kind catalogue,
  `actor` contracts) from the type-system spec and design notes.
