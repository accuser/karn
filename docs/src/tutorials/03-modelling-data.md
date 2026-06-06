# 3. Model your data with types

Karn gives you three ways to shape data, and choosing the right one is most of
the work of modelling a domain well:

- **Records** group related fields together.
- **Sum types** express "one of several alternatives".
- **Opaque types** give a value a distinct identity so it cannot be confused
  with another value of the same underlying shape.

In this tutorial we build a tiny `shop` domain that uses all three. Create a
file `shop.karn` and follow along; we will compile it at the end.

## An opaque type for identity

An order needs an identifier. We *could* use a plain `String`, but then nothing
stops us passing a customer's name where an order id is expected — they are both
strings. An **opaque type** prevents that:

```karn
type OrderId = opaque String
```

`OrderId` is backed by a `String`, but it is its own type. You cannot use a
`String` where an `OrderId` is wanted, or vice versa, without going through a
constructor. Inside the module that defines it, you build one with
`OrderId.unsafe("ord-1")`. It compiles to a branded type:

```typescript
export type OrderId = string & { readonly __brand: "OrderId" };
```

## A sum type for status

An order is in exactly one of several states, and some of those states carry
extra data. That is precisely what a **sum type** expresses:

```karn
type Status =
  | Pending
  | Shipped(tracking: String)
  | Cancelled(reason: String)
```

`Status` is one of three *variants*. `Pending` carries nothing; `Shipped`
carries a tracking string; `Cancelled` carries a reason. You construct a variant
by naming it — `Pending`, or `Shipped("1Z999")`. It compiles to a discriminated
union:

```typescript
export type Status =
    { readonly tag: "Pending" }
  | { readonly tag: "Shipped"; readonly tracking: string }
  | { readonly tag: "Cancelled"; readonly reason: string };
```

## A record to tie it together

A **record** groups fields into a single value:

```karn
type Order = {
  id: OrderId,
  item: String,
  status: Status,
}
```

Notice the fields reuse the types we just defined. You construct a record by
naming it and giving every field a value:

```karn
fn newOrder(id: OrderId, item: String) -> Order {
  Order { id: id, item: item, status: Pending }
}
```

Records are immutable. To produce a changed copy, use the **spread** form
`{ ...o, … }`, which copies every field and overrides the ones you name:

```karn
fn ship(o: Order, tracking: String) -> Order {
  Order { ...o, status: Shipped(tracking) }
}
```

Record types compile to a TypeScript `interface` with `readonly` fields, and
construction is a plain object literal — `ship` becomes
`{ ...o, status: Status.Shipped(tracking) }`.

## Consuming a sum type with `match`

To read a sum type, you `match` on it. `match` forces you to handle **every**
variant, and it binds each variant's payload to a name you can use:

```karn
fn describe(o: Order) -> String {
  match o.status {
    Pending => "awaiting shipment"
    Shipped(tracking: t) => t
    Cancelled(reason: r) => r
  }
}
```

If you forget a variant, the compiler rejects the program — there is no way to
fall through a case by accident. `match` compiles to a `switch` on the tag, with
each payload pulled out as a local:

```typescript
export function describe(o: Order): string {
  switch (o.status.tag) {
    case "Pending": {
      return "awaiting shipment";
    }
    case "Shipped": {
      const t = o.status.tracking;
      return t;
    }
    case "Cancelled": {
      const r = o.status.reason;
      return r;
    }
  }
  throw new Error("non-exhaustive match");
}
```

## Compile the whole thing

Here is the complete `shop.karn`:

```karn
commons shop {
  type OrderId = opaque String

  type Status =
    | Pending
    | Shipped(tracking: String)
    | Cancelled(reason: String)

  type Order = {
    id: OrderId,
    item: String,
    status: Status,
  }

  fn newOrder(id: OrderId, item: String) -> Order {
    Order { id: id, item: item, status: Pending }
  }

  fn ship(o: Order, tracking: String) -> Order {
    Order { ...o, status: Shipped(tracking) }
  }

  fn describe(o: Order) -> String {
    match o.status {
      Pending => "awaiting shipment"
      Shipped(tracking: t) => t
      Cancelled(reason: r) => r
    }
  }
}
```

Compile it:

```sh
karnc compile shop.karn --output shop.ts
```

## What you have done

You modelled a small domain with the three core type kinds — an opaque
`OrderId`, a `Status` sum type with payloads, and an `Order` record — and
consumed the sum with an exhaustive `match`. This is the everyday vocabulary of
Karn data modelling.

Next we sharpen these types further: how do you stop an *invalid* value — an
empty title, a negative quantity — from being constructed at all?

➡️ **[Tutorial 4: Make illegal states unrepresentable](04-refined-types.md)**

---

*For the reasoning behind opacity, sums, and immutable records, see
[The type-system philosophy](../explanation/type-system-philosophy.md). For
exact rules, see the [type system reference](../reference/types.md).*
