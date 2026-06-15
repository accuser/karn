# Lay out a project

**Goal:** structure a multi-file project with source and tests, and build it.

A project is a directory containing a `karn.toml` manifest plus `src/` and
`tests/` trees:

```text
my-project/
├── karn.toml
├── src/
│   ├── counters.karn       # context counters
│   └── quantities.karn     # commons quantities
└── tests/
    ├── counters.karn       # test counters
    └── quantities.karn     # test quantities
```

## The manifest

`karn.toml` names the project and its directory layout:

```toml
[project]
name = "my-project"
version = "0.1.0"

[paths]
src = "src"
tests = "tests"
```

See the [`karn.toml` reference](../../reference/manifest.md) for every key.

## Path identity

A unit's path must match its qualified name. A file declaring `context counters`
must be `src/counters.karn`; one declaring `context commerce.orders` must be
`src/commerce/orders.karn`. A test file mirrors the name of the unit it tests
under `tests/`, so `test counters` lives in `tests/counters.karn` — or, with the
optional self-identifying suffix, `tests/counters.test.karn`. Both forms are
accepted (the `.test.karn` suffix is what single-tree layouts use, and is handy
for grepping); use whichever you prefer.

> Mismatches are reported as `karn.project.inconsistent_commons_name` (source) or
> `karn.project.inconsistent_test_path` (tests).

## Build and test

```sh
karnc compile . --output out      # compile the project
karnc test .                      # compile and run the tests
karnc check .                     # type-check only
```

## Related

- [Write tests and mock collaborators](../testing/write-tests.md).
- [Target Cloudflare Workers](cloudflare-workers.md).
- Reference: [`karn.toml` manifest](../../reference/manifest.md).
