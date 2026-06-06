# 6. Test it

A language built around correctness should make tests easy, and Karn builds
testing in: `test` blocks, `assert`, value fabrication with `Mock[T]`, and
collaborator mocking with `mocks`. In this final tutorial we test the `Counter`
agent from [Tutorial 5](05-stateful-agent.md) and meet each of those tools.

## Lay out a test project

Tests live in their own tree, declared in a `karn.toml` manifest. Create this
layout:

```text
counters/
├── karn.toml
├── src/
│   ├── counters.karn
│   └── quantities.karn
└── tests/
    ├── counters.karn
    └── quantities.karn
```

The manifest names the two trees:

```toml
[project]
name = "counters"
version = "0.1.0"

[paths]
src = "src"
tests = "tests"
```

Each test file's path under `tests/` mirrors the name of the unit it tests, so
`tests/counters.karn` tests the `counters` context. Put the `Counter` agent from
Tutorial 5 in `src/counters.karn`, and add a small refined type in
`src/quantities.karn` that we will use later:

```karn
commons quantities

type Quantity = Int where InRange(1, 100)
```

## Write a test and assert

A test file is a `test` block naming its target, containing one or more named
cases. Inside a case, `assert` checks a condition. Put this in
`tests/counters.karn`:

```karn
test counters {
  test "a fresh counter starts at zero" {
    let n <- Counter(CounterId.unsafe("fresh")).current()
    assert n == 0
  }

  test "increment advances the count" {
    let c = Counter(CounterId.unsafe("a"))
    let _ <- c.increment()
    let n <- c.increment()
    assert n == 2
  }
}
```

Two things to notice. We address an agent by constructing it with a key —
`Counter(CounterId.unsafe("fresh"))` — and call its handlers on the result.
Because handlers return an `Effect`, we bind their results with `<-` rather than
`=`. The first test proves *fresh-state initialisation*: a key never seen before
reads `0`. The second proves state *persists* across calls to the same key.

## Run the tests

Run the whole suite with `karnc test`:

```sh
karnc test .
```

`karnc` compiles the project (including the tests), type-checks the generated
TypeScript with `tsc`, and runs it with Node. You will need `tsc` and `node` on
your path. The output:

```text
Running tests...

counters:
  ✓ a fresh counter starts at zero
  ✓ increment advances the count

2 passed, 0 failed.
```

`assert` is only valid inside a test case — using it elsewhere is a compile
error (`karn.assert.outside_test`), so test-only checks can never leak into
production code.

## Fabricate values with `Mock[T]`

Tests often need a value of some type without caring exactly what it is.
`Mock[T]` fabricates one. For a refined type it produces a value that satisfies
the refinement; pass an argument to pin a specific one. Add `tests/quantities.karn`:

```karn
test quantities {
  test "a bare mock satisfies the refinement" {
    let q = Mock[Quantity]
    assert q == q
  }

  test "a pinned mock takes the given value" {
    let q = Mock[Quantity](50)
    assert q == q
  }
}
```

`Mock[Quantity]` yields a valid `Quantity` (the low end of its range);
`Mock[Quantity](50)` pins it to `50`, checked against the refinement at compile
time. Like `assert`, `Mock[T]` is test-only (`karn.mock.outside_test` outside a
test). Some types need a pin — a `Matches`-refined string can't be fabricated
blindly, so a bare `Mock` of one is rejected with `karn.mock.needs_pin`.

## Mock a collaborator with `mocks`

When code under test depends on a collaborator, you can replace that collaborator
with a test implementation using `mocks`. Suppose `src/payments.karn` declares a
context whose `authorise` service depends on a `Logger` capability:

```karn
context payments

type AuthId = opaque String
type PaymentError = | Declined

capability Logger {
  fn log(msg: String) -> Effect[()]
}

provides Logger = ConsoleLogger {
  fn log(msg: String) -> Effect[()] {
    ()
  }
}

service authorise {
  on call(amount: Int) -> Effect[Result[AuthId, PaymentError]] given Logger {
    let _ <- Logger.log("authorise")
    if amount > 0 {
      Ok(AuthId.unsafe("AUTH-OK"))
    } else {
      Err(Declined)
    }
  }
}
```

A `capability` is a dependency the service asks for with `given`. In a test you
supply a stand-in with `mocks`, then call the service as usual in
`tests/payments.karn`:

```karn
test payments {
  mocks Logger = SilentLogger {
    fn log(msg: String) -> Effect[()] {
      ()
    }
  }

  test "authorise succeeds for a positive amount" {
    let r <- authorise.call(100)
    assert r is Ok(_)
  }

  test "authorise declines a zero amount" {
    let r <- authorise.call(0)
    assert r is Err(_)
  }
}
```

The `SilentLogger` replaces the real `Logger` for these tests. Note the
`assert r is Ok(_)` form: `is` matches a value against a pattern and yields a
`Bool` — perfect for asserting "this is an `Ok`, I don't care about the payload".

Run everything again:

```sh
karnc test .
```

```text
counters:
  ✓ a fresh counter starts at zero
  ✓ increment advances the count
payments:
  ✓ authorise succeeds for a positive amount
  ✓ authorise declines a zero amount
quantities:
  ✓ a bare mock satisfies the refinement
  ✓ a pinned mock takes the given value

6 passed, 0 failed.
```

> Capabilities and `given`-based dependency injection are a topic in their own
> right; here we only need enough to mock one. See the how-to guides for the
> full treatment.

## What you have done — and where to go

You laid out a test project, wrote `test` cases with `assert`, ran them with
`karnc test`, fabricated values with `Mock[T]`, and mocked a collaborator with
`mocks`. You have now travelled the whole spine: from a first compiled program,
through an HTTP service, data modelling, refined types, and a stateful agent, to
a tested codebase.

From here:

- **Have a specific task?** The [how-to guides](../how-to/index.md) are recipes
  for individual jobs.
- **Need exact behaviour?** The [reference](../reference/index.md) is the
  consultable source of truth.
- **Want the reasoning?** The [explanation](../explanation/index.md) section
  covers the *why* behind Karn's design.

---

*For the reasoning behind `Mock[T]` and test isolation, see
[The testing philosophy](../explanation/testing-philosophy.md). For exact rules,
see the [testing reference](../reference/testing.md).*
