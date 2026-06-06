# Narrow and bind with `is`

**Goal:** test whether a value matches a variant — and optionally bind its
payload — as a `Bool` expression.

An `is` expression tests a value against a variant pattern and evaluates to a
`Bool`. Use it where you want a single condition rather than a full `match`.

## Test a variant

```karn
commons test {
  fn isOk(r: Result[Int, String]) -> Bool {
    r is Ok(_)
  }
}
```

The wildcard `_` ignores the payload. This compiles to a tag check
(`r.tag === "Ok"`).

## Bind a payload in an `if`

When the pattern names a variable, that variable is in scope in the `if`'s
then-branch:

```karn
commons test {
  fn useValue(r: Result[Int, String]) -> Int {
    if r is Ok(n) {
      n
    } else {
      0
    }
  }
}
```

## In assertions

Because `is` yields a `Bool`, it pairs naturally with `assert` in tests:

```karn
assert result is Ok(_)
```

The receiver can be any expression of a sum/`Result`/`Option` type — an
identifier, a field access, or a call result.

## Related

- For exhaustive multi-way branching, use [`match`](match.md).
- [Write tests and mock collaborators](../testing/write-tests.md).
