# 0135 — real-time track closure: `parTraverse` (parallel broadcast) and the §20 chat-room end-to-end; the held-aware iteration borrow surface, completed

- **Status:** Accepted (real-time track, slice 4 — the closure; 2026-06-28).
- **Provenance:** the broadcast / held-aware-iteration piece deferred since slice 2 and named the slice-4 closure by ADRs 0130–0134. Realises the §20 worked example in full (`bynk-design-notes.md` §20 — a posted message fanned out to every connection in a room). **Security-bearing by association** (it sends on already-authenticated held connections — no new boundary); ran `/security-review` + `/code-review` to honour the track posture. **This slice retires the real-time / WebSocket track.**
- **Realises:** §20 (the chat-room, end-to-end) and §2.9's held-aware iteration borrow. Consumes the held-resource model ([ADR 0130](0130-held-resource-linearity.md)) and the whole `from WebSocket` protocol ([ADRs 0131–0134](0131-from-websocket-protocol-bundle.md)).

## Context

A held-aware iteration **broadcast** over a `store Map[K, Connection]` already
compiled on both targets before this slice — `conns.forEach((c) => c.send(frame))`
lowers to a scan over the connections (resolving connIds on Workers, skipping closed
ones) with each `send`-ed, the closure parameter a borrowed held binding. So the
broadcast *surface* was assembled incrementally across slices 2 + 3b-ii. Slice 4 is
the **closure**: the parallel primitive, the end-to-end proof, and a latent
borrow-enforcement gap the proof exposed.

## Decisions

- **D1 — `parTraverse`, the parallel broadcast primitive.** `<query>.parTraverse(f)`
  with `f: (T) -> Effect[()]`, type-identical to the existing sequential `forEach` but
  lowering to `await Promise.all(xs.map(x => f(x)))`. A sequential broadcast
  head-of-line-blocks the whole room on one slow or half-dead connection;
  `parTraverse` issues the sends concurrently. It is the §20 form. *Recommended;* a
  small kernel sibling of `forEach`, same borrowed-closure semantics. (One honest
  limit: `Promise.all` **rejects on the first failing send** — so a single dead
  connection surfaces an error for the whole broadcast even though every send was
  already dispatched concurrently. This satisfies the latency goal — no
  head-of-line-blocking — but not failure-isolation; `Promise.allSettled` is the
  named follow-on if a half-dead connection must not surface an error for the rest.)

- **D2 — exclude-self by key, not connection identity.** "Broadcast to everyone but
  the sender" filters on the sender's **key** (`UserId`), not on `c != conn`:
  `Connection` is non-comparable by design (ADR 0130, `bynk.types.held_not_comparable`),
  and comparing connections is a compile error. *Recommended;* it keeps
  non-comparability settled and reads clearly (the sender's id is already in scope).

- **D3 — the held-iteration borrow is now actually enforced.** A latent gap: a store
  map's `forEach`/`parTraverse` receiver was never recorded in the type table, so the
  linearity pass could not see it as held-bearing and silently **failed to enforce the
  borrow** on the closure parameter — `forEach((c) => c.close())` compiled. Slice 4
  records the receiver's lifted `Query[V]` type, so the closure parameter is correctly
  lent as **borrowed**: `send` is allowed, `close`/transfer is
  `bynk.held.consume_on_borrow`, and there is no disposal obligation. (This fixes
  `forEach` too, not only the new `parTraverse`.)

- **D4 — bare-map iteration is the surface; `.values` deferred.** The design notes
  write `connections.values.parTraverse(…)`, but `<map>.values` currently resolves as
  a cross-context path (a resolver-layer concern), whereas the **bare** map already
  lifts to the values query — `conns.parTraverse(…)` works directly. Per the proposal's
  fallback, bare-map iteration is the v1 surface; a `.values` accessor is a named
  ergonomic follow-on (alongside lambda parameter-type inference — the §20's
  unannotated `(c) =>` warns today; the slice annotates).

## Internal architecture

- **`bynk-check`:** `parTraverse` joins `forEach` in the `Query` kernel (same effectful-
  closure typing) and in the linearity borrowing-call set; the store-map query dispatch
  records the receiver's `Query[V]` type so the borrow fires.
- **`bynk-emit`:** `parTraverse` lowers to `Promise.all(xs.map(f))`; the held-`Map`
  resolution scan (3b-ii) is reused unchanged, so a Workers broadcast resolves connIds
  then `Promise.all`s the sends.
- **No runtime changes.**

## The proof — the §20 chat-room runs end-to-end

The bundle behaviour test drives the full lifecycle with two participants in one room:
both `open` (welcome frames), one sends a message → `on message` posts it → `Room.post`
`parTraverse`s every held connection → **both** receive the broadcast; one `close`s
(leaves) → the next broadcast reaches **only** the remaining one. Captured on
`TestConnection`s, run green under node. The Workers emission (the connId-resolving
`parTraverse` + `Promise.all`) stays covered by `tsc --strict` (fixture 238) + the node
strip-types guard; no real Workers runtime proof (needs Miniflare/workerd).

## The track retires

With slice 4 the real-time / WebSocket track that began with `Stream[T]` (slice 0) is
**complete**: the §20 chat-room — edge auth (`by`), a held connection transferred to an
agent, surviving Durable Object hibernation, inbound frames decoded and dispatched, and
a message fanned out to every connection in the room — compiles, type-checks under
`tsc --strict`, and runs end-to-end on the bundle target. Named follow-ons that are
deliberately *not* part of the track: the `.values` accessor, lambda parameter-type
inference, a non-Cloudflare `Connection` binding, and a streaming `Ai` / `Queue`-out
consumer (a sibling delivery track).
