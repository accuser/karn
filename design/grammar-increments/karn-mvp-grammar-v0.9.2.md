# Karn v0.9.2 — Agent-Emission Repair + State-Init Decision

A repair increment, not a feature one. It fixes emission of a feature that's
existed since v0.5 — agents — but has never produced valid TypeScript, and pins
down the runtime semantics of agent state initialisation, which the language has
implicitly assumed but never specified.

The bugs surfaced when the `135_url_shortener_stateful` fixture became the first
project-form fixture with stateful agents to go through the `tsc --strict`
verification stage added in v0.9.1. They are:

1. **Agent instantiation is mis-emitted.** `Hits(code)` emits as a plain call to
   a class (missing `new`, key passed where a `DurableObjectState` is expected).
   The emitter is not lowering "agent keyed by `code`" into "obtain the instance
   for this key."
2. **Agent method calls emit a `/* unknown */` placeholder.**
   `hits.increment()` emits as `await /* unknown */.increment(hits)` — receiver
   shoved in as an argument, deps dropped, module qualifier unresolved. This is
   the *same* placeholder the v0.7 runtime-emission task claimed to fix; the fix
   was either incomplete or has regressed since, and because no tsc'd fixture
   covered the agent path, the regression went undetected for two further
   increments.
3. **`makeSurface`'s deps type uses a fixed parameter index.** `Parameters<typeof
   create.call>[1]` indexes the second parameter, which is correct only for
   single-arg service operations. Multi-arg operations (`create(code, target,
   deps)`) put deps at `[2]`; the fixed `[1]` resolves to a real argument
   (`target: Url`) and the deps object is mistyped throughout `compose.ts`.
4. **Fresh agent state is undefined.** The emitted `loadState` does
   `(await this.state.storage.get("state"))!` — for an unwritten key, `get`
   returns `undefined` and the `!` masks it, so a fresh agent's state-field
   accesses crash at runtime. The language has never said what a never-seen
   agent's state should be; this increment decides.

Bugs 1–3 are emitter bugs. Bug 4 is a language-semantics decision with an
emission consequence. They are bundled because they're the same surface: making
agents actually work in shipped programs.

Read the earlier specs (v0.5 introduced agents; v0.7 added the runtime emission;
v0.8 added the workers target; v0.9 added HTTP; v0.9.1 added tsc verification),
plus the `135_url_shortener_stateful` fixture's FIXTURE_README, before this. The
v0.9.2 compiler accepts every v0–v0.9.1 program unchanged.

---

## 1. Scope

### In scope

- Agent instantiation lowering in both bundle and workers targets, with a per-key
  state lifecycle (same key → same state across calls in a session; fresh per
  test).
- Agent method-call lowering in both targets — direct method calls in bundle
  mode, DO stub fetches in workers mode via a `/_karn/agent/<method>` wire
  protocol.
- State-init: `loadState` synthesises a zero-value state record when storage
  has no committed value, for an admissible set of state-field types.
- A compile-time check restricting agent state-field types to those with a
  defined zero (Int, Bool, String, Option, List, records of these); other types
  in state are a compile error pending future initialiser syntax.
- `makeSurface` deps-type derivation that works for any service-operation
  arity.
- Workers-mode DO bindings in `wrangler.toml` (one per agent class in the
  context).
- Permanent tsc'd integration fixtures for agent emission (including the
  stateful URL-shortener) so this class of bug cannot regress unobserved.

### Out of scope (deferred)

- **Explicit agent state initialiser syntax** (`init { field: expr, ... }` on
  the agent declaration). Useful for sum-typed state, opaque-typed state, or
  refined types whose refinement doesn't admit the underlying zero. Its own
  later increment.
- **Refined-construction ergonomics** (finding #7) — next increment after this
  one.
- **Nested constructor patterns** — separate increment.
- **`on queue` / `on cron`** (v0.10).
- **DO migration / versioning** — agent state schema changes across deploys.
  Production concern; later.
- **Agent observability** — logging, metrics from agent handlers. Later.

---

## 2. Item 1 — Agent instantiation lowering

### 2.1 The problem

The current emission of `Hits(code)`:

```typescript
const hits = Hits(code);                      // wrong: class called as function
```

Wrong two ways: `Hits` is a class (so needs `new`), and its constructor takes
`state: DurableObjectState`, not the key. The expression in Karn means "obtain
the agent instance for this key" — that's a *lookup-or-create* operation
parameterised by the key, not a constructor call.

### 2.2 The fix — bundle mode

Each context maintains a per-agent-class **state registry**: a map from key value
to `DurableObjectState` (the in-memory implementation already provided by the
v0.7 runtime). The same key returns the same state across calls within a
session; the registry resets per test.

Lowering of `Hits(code)`:

```typescript
const hits = makeBundleAgent(__hitsRegistry, code, (state) => new Hits(state));
```

Where `makeBundleAgent` (runtime helper) looks up the state for `code` (creating
a fresh `InMemoryStorage`-backed state if absent) and returns a `new Hits(state)`
wrapping it. The result is typed exactly as `Hits` (the class), so all method
calls on it type-check normally.

Per test, the harness resets every registry. A fresh test sees a clean slate.

### 2.3 The fix — workers mode

In workers, `Hits` is a Durable Object class registered in `wrangler.toml`.
"Obtain the instance for this key" means: get the DO namespace from `env`,
compute a DO id from the key, get a stub.

Lowering of `Hits(code)`:

```typescript
const hits = makeWorkersAgent<typeof Hits>(env.HITS, code);
```

Where `makeWorkersAgent` (runtime helper) does
`env.HITS.get(env.HITS.idFromName(serialiseKey(code)))` and returns a typed
wrapper exposing the agent's method signatures — so call sites read identically
to bundle mode (`hits.increment(deps)`) even though method calls actually go
over `fetch` (see §3.3).

Workers target additionally emits to `wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "HITS"
class_name = "Hits"
```

One binding per agent class declared in the context, with the binding name being
the upper-snake-case agent name.

### 2.4 Key serialisation

The key passed to `idFromName` (workers) and used as the map key (bundle) must
be a stable string. For `key code: ShortCode` (refined String), the underlying
string is the natural choice. For other primitive keys (`Int`, `Bool`), it's the
JSON form. For record keys: deterministic JSON (sorted fields). The runtime
provides `serialiseAgentKey(value, typeDescriptor)` doing this consistently.

This means **two semantically-equal keys must serialise identically** — Karn's
equality on the key type and string-equality of the serialised form must agree.
For the v0.9.2 admissible key types (refined primitives, opaque primitives,
records of these), this falls out of the existing wire-format serialisation
machinery from v0.8.

---

## 3. Item 2 — Agent method-call lowering

### 3.1 The problem

```typescript
const total = await /* unknown */.increment(hits);   // wrong on every axis
```

Three things wrong: the receiver is in the wrong position (passed as an
argument), the module/namespace is unresolved (the `/* unknown */`), and the
`deps` argument is dropped.

### 3.2 The fix — bundle mode

A direct method call on the agent instance:

```typescript
const total = await hits.increment(deps);
```

The agent class's method signature already accepts deps (the v0.5 emission was
correct on that — `async increment(deps: {}): Promise<Result<...>>`). The call
site just has to *use* it.

### 3.3 The fix — workers mode

In workers, the "agent instance" is a stub, not an instance of `Hits`. Method
calls go over `fetch`. The wire protocol mirrors v0.8's cross-context Service
Binding protocol, but on the DO stub and under the path `/_karn/agent/<method>`:

```typescript
// caller
const total = await callDurableObjectMethod<
  Result<number, AnalyticsError>
>(hits.stub, "increment", /* args */ [], deps);

// runtime helper
async function callDurableObjectMethod<R>(
  stub: DurableObjectStub,
  method: string,
  args: unknown[],
  deps: unknown,
): Promise<R> {
  const response = await stub.fetch(`https://_karn/_karn/agent/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args, deps }),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as R;
}
```

The DO class gains a `fetch` handler that dispatches:

```typescript
async fetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/_karn/agent/")) {
    const methodName = url.pathname.slice("/_karn/agent/".length);
    const { args, deps } = await request.json();
    const result = await (this as any)[methodName](...args, deps);
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("Not Found", { status: 404 });
}
```

The `makeWorkersAgent` wrapper from §2.3 hides this so call sites read
identically across targets:

```typescript
const hits = makeWorkersAgent<typeof Hits>(env.HITS, code);
const total = await hits.increment(deps);    // wrapper proxies to callDurableObjectMethod
```

This is the same pattern v0.8 used for cross-context Service Bindings: a wrapper
that looks like a typed object but routes calls through a wire protocol.

### 3.4 The same call site, both targets

The single most important property: **the emitted call site is identical in both
modes** — `await hits.increment(deps)`. The difference is purely in what `hits`
is (a `Hits` instance vs. a typed proxy over a stub), which is controlled by
which `makeAgent` helper produced it. This keeps the rest of the emitter (and
the user's mental model) target-agnostic.

---

## 4. Item 3 — `makeSurface` deps-type derivation

### 4.1 The problem

```typescript
export function makeSurface(deps: Parameters<typeof create.call>[1]) { ... }
```

`Parameters<typeof create.call>` for `create.call(code, target, deps)` is
`[ShortCode, Url, {...}]`. `[1]` is `Url`. So `makeSurface(deps: Url)` — and
every call to `makeSurface({ CodeGen, surface: {...} })` then mistypes.

The bug only fires for services whose `on call` has more than one Karn-declared
parameter. v0.9.1's tsc stage missed it because `134_url_shortener` has only
single-arg operations.

### 4.2 The fix

Emit an explicit deps type per context, derived during checking, and reference
it directly — don't index `Parameters<>`. Sketch:

```typescript
export interface ShortenerLinksDeps {
  readonly CodeGen: CodeGen;
  readonly surface: {
    readonly Analytics: ReturnType<typeof shortener_analytics.makeSurface>;
  };
}

export function makeSurface(deps: ShortenerLinksDeps) { ... }
```

The interface is generated from the context's combined provider + consumed-
context surface, computed during checking. Service operations take `deps:
ShortenerLinksDeps` (or the relevant subset, if narrowed by `given`). No more
`Parameters<>` indexing anywhere in emission.

This also incidentally improves IDE experience and error messages — TypeScript
errors reference a named type, not a derived position.

---

## 5. Item 4 — State-init decision and the admissible state-field types

### 5.1 The decision

`loadState` returns a **zero-value state record** when storage has no committed
value for the key. A handler reading `self.state.count` against a fresh key sees
`0`, not `undefined`; matching `self.state.target` against `Some/None` matches
`None`.

This is the option I recommended in the post-fixture diagnosis. The alternative
(explicit initialisers on every agent) is more honest but invasive; defaults
match what every realistic example already assumes and keep the "fresh key" case
total. An explicit-initialiser syntax can still be added later, layered on top of
the defaults (an initialiser overrides zero-init).

### 5.2 Zero values, defined

For v0.9.2, the following Karn types are **zeroable** — they have a defined zero
value:

| Type | Zero |
|---|---|
| `Int` | `0` |
| `Bool` | `false` |
| `String` | `""` |
| `Option[T]` | `None` |
| `List[T]` | `[]` |
| Record `{ f₁: T₁, …, fₙ: Tₙ }` where every `Tᵢ` is zeroable | `{ f₁: zero(T₁), …, fₙ: zero(Tₙ) }` |

A refined type `T where P` is zeroable iff `T` is zeroable AND `P` holds for
`zero(T)` — checked statically at compile time for the predicates the v0–v0.9
type system supports (`NonNegative`, `LessThan(N)` for N > 0, `Matches(p)` for
patterns that match the empty string or `0` as appropriate, etc.). If the
zero-value cannot be proven to satisfy the refinement statically, the refined
type is **not zeroable**.

### 5.3 Non-zeroable types in state

Non-Option sum types, opaque types, and refined types whose refinement doesn't
admit the underlying zero are **not zeroable** in v0.9.2. An agent state
declaration containing a non-zeroable field is a compile error
(`karn.agents.non_zeroable_state_field`), with the note: "wrap the field in
`Option[…]`, or wait for explicit-initialiser syntax."

This is a deliberate v0.9.2 limitation. The URL-shortener's two agents
(`Hits.count: Int`, `Link.target: Option[Url]`) are both fully zeroable and
unaffected. Most realistic state shapes are records of primitives and Options,
which is exactly what the zeroable set covers. Sum-typed state machines and
opaque-typed state fields wait for the initialiser-syntax increment.

### 5.4 `loadState` emission

```typescript
private async loadState(): Promise<HitsState> {
  const stored = await this.state.storage.get<HitsState>("state");
  return stored ?? __zeroOfHitsState();
}
```

Where `__zeroOfHitsState` is an emitter-generated constant or factory expressing
the zero record. The result is always a valid `HitsState`; the handler never
sees `undefined`.

The `!` non-null assertion that hid the bug is gone.

### 5.5 What this answers, what it doesn't

This answers finding #10: fresh agent state reads as the zero-value record.
Probe tests in `135_url_shortener_stateful` are expected to go green under
v0.9.2 — that's the integration-fixture confirmation.

It does **not** answer: how does an agent distinguish "first access ever" from
"reset to zero"? It can't, under defaults — by design. If a user needs that
distinction, the current escape hatch is to make a state field
`Option[ActuallyMyType]` (None means "never set"). The future explicit-init
increment will add a cleaner mechanism.

---

## 6. Putting it together — the fixed emission for `analytics.ts`

For reference, the emitted analytics context after v0.9.2 (eliding doc comments
and unrelated bits):

```typescript
const __hitsRegistry = new StateRegistry<ShortCode>();   // bundle only

export class Hits {
  state: DurableObjectState;
  constructor(state: DurableObjectState) { this.state = state; }

  private async loadState(): Promise<HitsState> {
    const stored = await this.state.storage.get<HitsState>("state");
    return stored ?? { count: 0 };
  }

  private async commitState(s: HitsState): Promise<void> {
    await this.state.storage.put("state", s);
  }

  async increment(deps: {}): Promise<Result<number, AnalyticsError>> {
    const currentState = await this.loadState();
    const next = currentState.count + 1;
    await this.commitState({ ...currentState, count: next });
    return Ok(next);
  }

  // ...

  async fetch(request: Request): Promise<Response> {
    // workers only — dispatches to the methods above
  }
}

export const track = {
  async call(code: ShortCode, deps: {}): Promise<Result<number, AnalyticsError>> {
    const hits = makeAgent(__hitsRegistry, env?.HITS, code, (state) => new Hits(state));
    const total = await hits.increment({});
    return total;
  },
};

export interface ShortenerAnalyticsDeps {}

export function makeSurface(deps: ShortenerAnalyticsDeps) { ... }
```

(The `makeAgent` helper is a single runtime function that picks bundle vs
workers behaviour based on whether `env?.HITS` is present. Implementation detail;
the user sees `makeAgent(...)` uniformly.)

---

## 7. Test corpus

### Positive fixtures (new for v0.9.2)

```
tests/positive/
├── 136_agent_instantiation_bundle/    -- single agent, single key, bundle target,
│                                         method call → tsc clean
├── 137_agent_instantiation_workers/   -- same, workers target, DO bindings emitted
├── 138_agent_state_zero_int/          -- fresh key reads count == 0
├── 139_agent_state_zero_option/       -- fresh key reads target == None
├── 140_agent_state_zero_record/       -- fresh key reads a nested record of zeros
├── 141_makesurface_multi_arg/         -- service with multi-arg `on call`, makeSurface
│                                         deps type correct, compose wires up cleanly
```

### Negative fixtures (new for v0.9.2)

```
tests/negative/
├── 104_state_sum_field/               -- non-Option sum in state → non_zeroable_state_field
├── 105_state_opaque_field/            -- opaque type in state → non_zeroable_state_field
├── 106_state_refined_no_zero/         -- Int where Positive (excludes 0) → not zeroable
```

### Integration fixtures

```
tests/projects/
├── 135_url_shortener_stateful/        -- the prepared stateful URL-shortener; must:
│                                         (a) compile both targets,
│                                         (b) pass `karnc test` — all probes go green,
│                                         (c) pass `tsc --strict` on both targets
```

The stateful URL-shortener becomes a permanent integration fixture, joining
`134_url_shortener` from v0.9.1. Together they cover agent-bearing and
agent-free project shapes, and every shipped feature gets a tsc'd project
fixture from now on (a process commitment, not just a fixture addition).

---

## 8. Implementation notes

### 8.1 Where the code goes

- **Item 1 (instantiation):**
  - `checker.rs`: agent-expression resolution — `Hits(code)` resolves to an
    "agent instance for key" expression, not a function call.
  - `emitter.rs`: bundle emission generates the per-context state registry and
    lowers `Hits(code)` via `makeAgent(...)`.
  - Workers emission generates the DO binding declarations in
    `wrangler.toml` and lowers via `makeWorkersAgent(...)`.
  - `runtime_emission.rs`: `StateRegistry`, `makeAgent`, `makeWorkersAgent`,
    `serialiseAgentKey`.

- **Item 2 (method calls):**
  - `emitter.rs`: method-call lowering on agent instances — eliminate the
    `/* unknown */` code path *with prejudice* (it should be impossible to emit
    after this). In workers mode, the DO class's `fetch` handler is generated.
  - `runtime_emission.rs`: `callDurableObjectMethod`.

- **Item 3 (deps type):**
  - `checker.rs`: compute the per-context deps interface (provider + consumed
    surfaces) during checking, store on the context.
  - `emitter.rs`: emit the explicit `XDeps` interface; reference it from
    `makeSurface` and every service-operation signature instead of
    `Parameters<>` indexing.

- **Item 4 (state init):**
  - `checker.rs`: zeroability analysis for state-field types; reject
    non-zeroable types with the new diagnostic.
  - `emitter.rs`: emit the per-agent `__zeroOfXState` constant and the
    `stored ?? __zeroOf...()` form in `loadState`.

### 8.2 The `makeAgent` helper

Single runtime helper that abstracts the bundle/workers difference:

```typescript
export function makeAgent<C>(
  registry: StateRegistry<unknown>,
  binding: DurableObjectNamespace | undefined,
  key: unknown,
  constructBundle: (state: DurableObjectState) => C,
): C {
  if (binding) {
    return makeWorkersAgent(binding, key) as unknown as C;
  }
  const state = registry.getOrCreate(key);
  return constructBundle(state);
}
```

Call sites are identical across targets; the helper picks the right path.

### 8.3 Risk areas

- **Workers-mode method-call types.** The proxy returned by `makeWorkersAgent`
  has to have the agent's typed signatures, but at runtime every call routes
  through `callDurableObjectMethod`. The proxy is typically a `Proxy` object
  with a get-handler that returns a typed function — implement carefully, and
  add a fixture that exercises type inference at call sites in workers mode.

- **Registry reset hygiene.** Tests must see fresh registries. The harness
  already has a per-test setup point (it's how InMemoryStorage gets reset);
  hook registry reset into the same place.

- **The v0.7 regression.** The `/* unknown */` placeholder was supposedly fixed
  in v0.7. Either it's an incomplete fix (handled some call sites, not others)
  or it regressed after v0.7 because no test caught it. **Find out which, and
  in the fix, ensure the placeholder is impossible to emit going forward** — not
  just absent in current outputs. A grep-the-output assertion in the harness
  for `/* unknown */` is a cheap final guard.

- **Zeroability for refined types.** The static check that a predicate admits
  the zero is straightforward for `NonNegative` (yes, 0 is non-negative) and
  `LessThan(N)` (yes if N > 0). For `Matches(p)`, it's "does the regex match
  the empty string?" — feasible. For unknown/arbitrary predicates, conservatively
  return "not zeroable" and surface the negative diagnostic. Don't try to be
  too clever in v0.9.2.

### 8.4 What "done" looks like

1. All v0–v0.9.1 fixtures pass (regression).
2. All v0.9.2 fixtures pass (6 positive, 3 negative, 1 integration project).
3. `135_url_shortener_stateful` compiles both targets, passes `karnc test` (all
   tests green, including the two state-init probes), passes `tsc --strict` on
   emitted output for both targets.
4. The `/* unknown */` placeholder is not present anywhere in any emitted
   output, and a harness check enforces this.
5. Workers-mode `wrangler.toml` declares the agent DO bindings correctly; the
   emitted `fetch` handler on each agent class dispatches `/_karn/agent/…`
   correctly.
6. The four bugs are each covered by a tsc'd fixture so none can regress
   undetected.
7. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean.

---

## 9. After v0.9.2

The agent surface is repaired and verified. The roadmap resumes:

- **v0.9.3 — Refined construction (finding #7).** Compile-time literal
  refinement checking; implement `Mock[T]`. Collapses the verbose `.of` +
  match-unwrap pattern that pervades the URL-shortener tests.
- **v0.9.4 — Nested constructor patterns.** Close the v0.6 spec/impl divergence:
  `Err(EmptyCart)` works.
- **v0.10 — `on queue` / `on cron`.** Background processing. The planned next
  feature increment, now on a base where agents work and refined types are
  pleasant to use.
- **v0.11+ — The planned feature roadmap continues** (state machines, provider
  composition, refinement narrowing, sagas, cross-context capability resolution,
  multi-Worker integration testing).

After v0.9.2 — for the first time — every shipped feature works end to end, and
the integration fixtures guarantee it stays that way.
