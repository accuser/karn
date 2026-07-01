---
title: "Write tests, mock collaborators, and pin a `Mock[T]`"
---
**Goal:** write and run tests, state expectations, fabricate values, and replace a
dependency.

Tests live in a project's `tests/` tree (see
[Lay out a project](/book/guides/projects-build-and-deployment/layout/)). A test file is a `suite` block naming
its target unit, containing named `case`s.

## Write and run

```bynk
suite counters {
  case "a fresh counter starts at zero" {
    let n <- Counter(CounterId.unsafe("fresh")).current()
    expect n == 0
  }
}
```

Run the suite:

```sh
bynkc test .
```

`bynkc test` compiles the project, type-checks it with `tsc`, and runs it with
Node, so both must be on your path. `expect` is valid only inside a `case`. It
takes the same `Bool` predicate an `invariant` does (`is`, `implies`, the
operators, pure methods) — one predicate surface across code and tests — and a
failure reports the predicate structure: `expected` versus `actual`.

## Fabricate values with `Mock[T]`

`Mock[T]` produces a value of `T`. For a refined type it satisfies the
refinement; pass an argument to pin a specific value:

```bynk
suite quantities {
  case "mocks" {
    let a = Mock[Quantity]       -- a valid Quantity
    let b = Mock[Quantity](50)   -- pinned to 50
    expect a == a
    expect b == b
  }
}
```

A `Matches`-refined string cannot be fabricated blindly — a bare `Mock` of one is
rejected ([`bynk.mock.needs_pin`](/book/troubleshooting/mock-errors/)); pin it
instead. `Mock[T]` is test-only.

## Mock a collaborator with `mocks`

Replace a capability the code under test depends on:

```bynk
suite payments {
  mocks Logger = SilentLogger {
    fn log(msg: String) -> Effect[()] {
      ()
    }
  }

  case "authorise succeeds for a positive amount" {
    let r <- authorise.call(100)
    expect r is Ok(_)
  }
}
```

The `SilentLogger` stands in for the real `Logger` for these cases.

## Related

- Tutorial: [Test it](/book/tutorials/06-testing/).
- Reference: [testing](/book/reference/testing/).
- Troubleshooting: [`bynk.mock.*` errors](/book/troubleshooting/mock-errors/).
