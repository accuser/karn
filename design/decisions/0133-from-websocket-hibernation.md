# 0133 — `from WebSocket` on Workers, hibernation re-association: a held connection survives Durable Object eviction by persisting its connection id and re-resolving the live socket

- **Status:** Accepted (real-time track, slice 3b-ii; 2026-06-28).
- **Provenance:** the **Q7** piece ADR 0132 deferred — "hibernation re-association lives in the runtime binding, keyed by a connection id via `serializeAttachment`." Slice 3b-i (ADR 0132) shipped a working edge-authenticated upgrade using the **non-hibernatable** `server.accept()` model (the socket lived in the DO's isolate memory and was lost on eviction). 3b-ii swaps that for the **hibernatable** WebSocket API so a stored connection survives hibernation, realising design notes §2.9.6. **Security-bearing** (same connection-into-an-agent boundary): ran `/security-review` + `/code-review`.
- **Realises:** design notes §2.9.6 ("a `Connection[F]` stored in agent state survives the agent's hibernation and is automatically available when the agent is rehydrated" — a platform-supplied property the language relies on but does not implement). Consumes the protocol surface + edge-auth + DO-hosted on-open of [ADR 0132](0132-from-websocket-protocol-workers.md) and the held-resource model of [ADR 0130](0130-held-resource-linearity.md).
- **Relates:** [ADR 0109](0109-agent-storage-staged-commit.md) (the staged-commit the held map now flushes through, being durable again).

## Context

3b-i accepted the socket with `server.accept()` and kept the live
`WorkersConnection` in an in-memory side-table (`heldStore`, keyed by the durable
state object) — plain isolate memory, torn down on eviction, dropping every live
connection. §2.9.6 promises the opposite. Cloudflare's hibernatable WebSockets
deliver it, but only if the socket is accepted via `state.acceptWebSocket(ws,
tags)` (not `ws.accept()`): the platform then preserves the socket across
hibernation and re-presents it via `state.getWebSockets(tag)` on wake. The
language relies on that guarantee; 3b-ii is the binding that wires the held
`Connection` onto it.

## Decisions

- **D1 — the held value is the connId, not the socket.** A live socket cannot be
  JSON-persisted, but a **connection id** can. The DO accepts via
  `state.acceptWebSocket(server, [connId])` under a fresh `crypto.randomUUID()`
  connId, `server.serializeAttachment({ connId })` persists the id on the socket
  (for wake-time recovery on the future inbound path), and a stored
  `Connection` persists the **connId string**. Every `Connection` access
  re-resolves connId → live socket via `state.getWebSockets(connId)`, so no live
  socket is ever held across requests and hibernation is transparent.

- **D2 — a held `store Map[K, Connection]` persists `Record<string(K), connId>`.**
  This reverses 3b-i's in-memory split: the stored value is now a serialisable
  string, so the held map rejoins the durable state record (interface, zero,
  rehydration **key** check, load/commit) and writing it triggers the same commit
  flush as any persisted field. `put` records `connIdOf(conn)`; `get` resolves the
  connId (`None` if the socket has since closed); `remove` resolves-closes-deletes;
  a query/iteration resolves the connIds, keeping the present connections. The
  connId is an opaque platform string — rehydration validates the textual `K` key
  but not the value. (The held maps stay *out* of the plain-`Map` lowering set:
  their entry ops use connId resolution, not `Record<string, V>` ops.)

- **D3 — resolution is fail-soft.** A connId that resolves to no socket is `None`,
  not a fault — a connection may have closed (client gone) while its connId lingered
  in the map until the next `remove`. Contrast the rehydration gate, which *faults*
  on malformed persisted data: a connId string is always structurally valid, and a
  missing live socket is normal lifecycle, not corruption.

- **D4 — `remove` closes; `update`/`upsert` are rejected.** `conns.remove(k)`
  resolves the connId, closes the live socket (a no-op if already closed), then
  deletes the entry — finally emitting the §2.9 "removes-and-closes" contract the
  3b-i lowering only deleted. `update`/`upsert` (which transform the value through a
  `(Connection) -> Connection` function) have no meaning for a held resource and are
  a **compile error** (`bynk.held.unsupported_map_op`) rather than a silent
  miscompile. Two honest limits, both noted: a `put` that **overwrites** an existing
  key does not close the displaced connection (the contract governs `remove`, not
  overwrite — a named follow-up if overwrite-while-held proves reachable), and the
  rehydration gate validates the textual `K` key but not the opaque connId value (a
  malformed value simply resolves to `None`, never a fault).

- **D5 — bundle unchanged.** There is no `acceptWebSocket`/`getWebSockets`
  off-Workers; a held map on the bundle/test target keeps the in-memory test-state
  record of `TestConnection`s (3b-i behaviour). The connId representation is
  Workers-only, selected at emit by target — exactly as 3b-i's split was.

## Internal architecture

- **Runtime (`connection.ts`):** `WorkersConnection` gains a public `connId`;
  helpers `acceptHibernatableConnection(state, server)` (fresh connId, `acceptWebSocket`,
  `serializeAttachment`, wrap), `resolveConnection(state, connId): Option<…>`
  (`getWebSockets`-by-tag, re-wrap), and `connIdOf(conn)`. A narrow
  `HibernatableState` view is reached by a cast so the shared `DurableObjectState`
  (and the bundle `makeTestState`) need not carry the hibernation API. The 3b-i
  in-memory `heldStore` is removed.
- **Emit:** a held `Map[K, Connection]` rejoins the state interface as
  `Record<string, string>`, zero `{}`, the rehydration key-check, and the
  write-detection set (it commits now); the DO `fetch` upgrade branch uses
  `acceptHibernatableConnection` instead of `server.accept()` + `new WorkersConnection`.
- **Lowering:** held-map entry ops target `__state.<map>` (the staged connId record)
  with `connIdOf`/`resolveConnection`; `remove` is an async resolve-close-delete.

## Deferred (named, not dropped)

- **Inbound frame dispatch — slice 3b-iii.** `webSocketMessage(ws, msg)` decoding
  against `in:` and routing to an agent handler needs a new protocol surface
  (inbound message handlers + frame→handler routing), independent of and larger than
  the hibernation binding. 3b-ii keeps the **send path** durable; the receive path is
  its own increment. (The `serializeAttachment({ connId })` written here is the hook
  3b-iii reads back on a waking dispatch.)
- **Broadcast-to-all-connections** — the held-aware iteration borrow surface, the
  slice-4 closure.

## Consequences

- A stored `Connection` survives DO eviction; §2.9.6 is realised end to end.
- The §20 chat-room re-emits + type-checks under `tsc --strict` on Workers with the
  hibernatable handlers (fixtures `237`/`235` re-blessed); `remove` now closes.
- No real-hibernation runtime proof in the unit harness (needs Miniflare/workerd) —
  coverage is the shape-snapshot fixtures + `tsc --strict` + the node strip-types
  guard, plus a manual `wrangler dev` note.
