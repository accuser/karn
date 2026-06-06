# 4. Make illegal states unrepresentable

The types from [Tutorial 3](03-modelling-data.md) describe the *shape* of data.
**Refined types** go further: they describe which *values* are allowed. An age
is not just any integer — it is an integer between 0 and 150. A username is not
just any string — it has a length and a permitted character set. With refined
types you push those rules into the type itself, so an invalid value cannot be
constructed.

Create `signup.karn` and follow along.

## Declare a refined type

A refined type is a base type plus a predicate, written with `where`:

```karn
type Age = Int where InRange(0, 150)
```

`Age` is an `Int`, but only one in the range 0–150. You can combine predicates
with `and`:

```karn
type Username = String where MinLength(3) and MaxLength(20)
```

Karn ships a fixed set of predicates — numeric ones like `NonNegative`,
`Positive`, and `InRange(lo, hi)`; string ones like `NonEmpty`, `MinLength(n)`,
`MaxLength(n)`, `Length(n)`, and `Matches(regex)`. The
[refined-type reference](../reference/refined-types.md) lists them all.

## Admit a literal — checked at compile time

When you write a literal where a refined type is expected, Karn checks it
**at compile time** and admits it directly. No validation call, no error
handling:

```karn
fn defaultAge() -> Age {
  18
}
```

`18` is a valid `Age`, so this compiles, lowering to `Age.unsafe(18)` — the
check happened in the compiler, so none is needed at runtime:

```typescript
export function defaultAge(): Age {
  return Age.unsafe(18);
}
```

Now try a value that is *not* valid. Change the body to `200` and run
`karnc check signup.karn`:

```text
[karn.refine.literal_violates] Error: literal 200 does not satisfy `InRange` required by type `Age`
```

This is the heart of "make illegal states unrepresentable": a nonsensical `Age`
is not a runtime bug to be caught later — it is a program that does not compile.
Change it back to `18` before continuing.

## Validate untrusted input with `.of`

Compile-time admission only works for literals you write yourself. Real input —
from a request, a database, a user — is not known at compile time, so it must be
*checked at runtime*. Every refined type has an `.of` constructor for exactly
this, and it **always** returns a `Result`:

```karn
fn parseAge(raw: Int) -> Result[Age, ValidationError] {
  Age.of(raw)
}
```

`Age.of(raw)` returns `Ok(age)` if `raw` is in range, or
`Err(validationError)` if it is not. The generated `.of` contains the predicate
as a runtime check:

```typescript
of(value: number): Result<Age, ValidationError> {
  if (!Number.isInteger(value)) {
    return Err({ field: "Age", message: "must be an integer", value });
  }
  if (!(value >= 0 && value <= 150)) {
    return Err({ field: "Age", message: "must be in range [0, 150]", value });
  }
  return Ok(value as Age);
}
```

## Handle the `Result`

Because `.of` returns a `Result`, the caller must deal with both outcomes. You
have two common ways.

**Propagate with `?`.** Inside a function that itself returns a `Result`, the
`?` operator unwraps an `Ok` or returns early on an `Err`:

```karn
fn greeting(name: String) -> Result[Username, ValidationError] {
  let u = Username.of(name)?
  Ok(u)
}
```

**Branch with `match`.** When you want to handle each case explicitly, match on
the `Result`:

```karn
fn isAdult(raw: Int) -> String {
  match Age.of(raw) {
    Ok(a) => "valid age"
    Err(e) => "invalid age"
  }
}
```

## A note on `.unsafe`

You will also see `.unsafe` — `Age.unsafe(18)` — which constructs the value
*without* checking. It is what compile-time admission lowers to, and you use it
directly only when you already know the value is valid (for example, a constant
you control). Prefer `.of` for anything that came from outside your program;
reach for `.unsafe` only when you can justify skipping the check.

## The whole file

```karn
commons signup {
  type Username = String where MinLength(3) and MaxLength(20)
  type Age = Int where InRange(0, 150)

  fn defaultAge() -> Age {
    18
  }

  fn parseAge(raw: Int) -> Result[Age, ValidationError] {
    Age.of(raw)
  }

  fn greeting(name: String) -> Result[Username, ValidationError] {
    let u = Username.of(name)?
    Ok(u)
  }

  fn isAdult(raw: Int) -> String {
    match Age.of(raw) {
      Ok(a) => "valid age"
      Err(e) => "invalid age"
    }
  }
}
```

```sh
karnc compile signup.karn --output signup.ts
```

## What you have done

You constrained values with refined types, watched the compiler reject an
invalid literal *before runtime*, validated untrusted input with `.of`, and
handled the resulting `Result` with both `?` and `match`. Illegal values now
have nowhere to live.

So far everything has been stateless. Next we give the program a memory.

➡️ **[Tutorial 5: Add a stateful agent](05-stateful-agent.md)**

---

*Why does admission work this way, rather than overloading `.of`? See
[The refined-literal admission model](../explanation/refined-literal-admission.md).
For the philosophy, see [The type-system philosophy](../explanation/type-system-philosophy.md).*
