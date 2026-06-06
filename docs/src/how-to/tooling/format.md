# Format your code with `karn-fmt`

**Goal:** format Karn source to the canonical style.

Karn's formatter is built into the compiler as `karnc fmt`.

## Format files in place

```sh
karnc fmt src/counters.karn
karnc fmt src/*.karn
```

This rewrites the named files to canonical form (tab indentation, normalised
spacing). For example:

```karn
commons demo {
type Id=Int
fn add(a:Int,b:Int)->Int{a+b}
}
```

becomes:

```karn
commons demo {
	type Id = Int

	fn add(a: Int, b: Int) -> Int { a + b }
}
```

## Format via stdin

Pass `-` to read from stdin and write to stdout — handy for editor integrations:

```sh
cat src/counters.karn | karnc fmt -
```

## Check formatting in CI

`--check` verifies formatting without writing, exiting non-zero if any file is
not already canonical:

```sh
karnc fmt --check src/*.karn
```

## Related

- [Set up editor support](editor-support.md) for format-on-save.
- Reference: [`karn-fmt`](../../tooling/karn-fmt.md).
