# 5. Add a stateful agent

Everything so far has been stateless: data goes in, a value comes out, nothing is
remembered. Real services remember things. In Karn, the unit of state is an
**agent** — a named thing, identified by a key, that owns some state and exposes
handlers to read and change it.

In this tutorial we build a `Counter` agent. Agents live inside a context, so
create a project directory with a `counters.karn` in it (as in
[Tutorial 2](02-http-service.md)).

## Declare an agent

```karn
context counters

type CounterId = opaque String

agent Counter {
  key id: CounterId

  state {
    count: Int,
  }

  on call current() -> Effect[Int] {
    self.state.count
  }
}
```

Three parts make up the agent:

- `key id: CounterId` — the identity. Each distinct `CounterId` is a separate
  counter with its own state. (We use an opaque `CounterId` from
  [Tutorial 3](03-modelling-data.md) so a counter's id can't be mixed up with
  any other string.)
- `state { count: Int }` — the data this agent owns.
- `on call current() -> Effect[Int]` — a handler. Handlers return an `Effect[T]`
  because they touch state; here, returning the plain `self.state.count` is
  automatically lifted into the `Effect`.

## State must be zeroable

Here is the rule that shapes agent state: **every state field must have a zero
value**. When you address a counter that has never been seen before, Karn
initialises its state automatically — there is no constructor to call first — so
each field needs a well-defined starting value. `Int` starts at `0`, `Bool` at
`false`, `String` at `""`, and `Option[T]` at `None`.

This is why our `count: Int` is fine: a brand-new counter starts at `0`. But a
field that *excludes* its natural zero is rejected. Try this:

```karn
state {
  level: Int where Positive,
}
```

`Positive` excludes `0`, so there is no valid starting value, and the compiler
says so:

```text
[karn.agents.non_zeroable_state_field] agent `Gauge` state field `level` has no
defined zero value, so a fresh key cannot be initialised
```

When you genuinely need "not set yet", reach for `Option`: a field
`reading: Option[Int]` is zeroable (it starts at `None`), and `None` *means*
"never set".

## Read and update state

Inside a handler, read state through `self.state`. To change it, build a new
state value and `commit` it. Add an `increment` handler:

```karn
  on call increment() -> Effect[Int] {
    let next = self.state.count + 1
    commit { ...self.state, count: next }
    next
  }
```

`commit { ...self.state, count: next }` is the record-spread form from
[Tutorial 3](03-modelling-data.md): copy the current state, override `count`, and
persist the result. State is never mutated in place; you commit a new value.

## See what it compiles to

Compile the project (the default `bundle` target is fine here):

```sh
karnc compile . --output out
```

The agent becomes a class that loads its state on entry and persists on
`commit`. The zero value is baked in as `__zeroOfCounterState`:

```typescript
const __CounterRegistry = new StateRegistry();
function __zeroOfCounterState(): CounterState { return { count: 0 }; }

export class Counter {
  // ...
  private async loadState(): Promise<CounterState> {
    const stored = await this.state.storage.get<CounterState>("state");
    return stored ?? __zeroOfCounterState();   // a fresh key starts from zero
  }

  async increment(deps: {}): Promise<number> {
    const currentState = await this.loadState();
    const next = currentState.count + 1;
    await this.commitState({ ...currentState, count: next });
    return next;
  }
}
```

That `?? __zeroOfCounterState()` is fresh-state initialisation in action: a key
with no stored state falls back to the zero value. On the `workers` target the
same agent compiles to a Cloudflare Durable Object instead, but the handler
logic you wrote is identical.

## The whole file

```karn
context counters

type CounterId = opaque String

agent Counter {
  key id: CounterId

  state {
    count: Int,
  }

  on call current() -> Effect[Int] {
    self.state.count
  }

  on call increment() -> Effect[Int] {
    let next = self.state.count + 1
    commit { ...self.state, count: next }
    next
  }
}
```

## What you have done

You declared an agent with a key and zeroable state, learned why state must
zero-initialise (and how `Option` covers "not set yet"), and wrote handlers that
read with `self.state` and update with `commit`. You saw fresh-state
initialisation in the emitted code.

We have asserted that this counter works — now let us prove it.

➡️ **[Tutorial 6: Test it](06-testing.md)**

---

*For what an agent really is and why state must be zeroable, see
[The agent model](../explanation/the-agent-model.md). For exact rules, see the
[agents reference](../reference/agents.md).*
