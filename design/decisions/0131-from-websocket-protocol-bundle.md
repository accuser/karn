# 0131 — the `from WebSocket` protocol (bundle vertical): edge-authenticated `on open`, a held-connection transfer to an agent, and the `TestConnection` runtime; the Workers hibernatable mapping is deferred

- **Status:** Accepted (real-time track, slice 3a; 2026-06-28).
- **Provenance:** the bundle half of the real-time / WebSocket track's slice 3, split from the proposal `design/proposals/v0.103-from-websocket-protocol.md` so the security-critical surface + checker + a runnable bundle vertical land first, and the Workers Durable-Object hibernatable upgrade (slice 3b) follows as a focused, separately-reviewed increment. **Security-bearing:** runs `/security-review` + `/code-review`. Settles the track's **Q5** within-handler/edge fault framing and **Q6**; **Q7** (hibernation) and the Workers half of **Q8** (the auth carrier's *runtime* read) are deferred to 3b.
- **Realises:** design notes §7 (the WebSocket protocol — "the boundary hands a long-lived resource to an agent") and §20 (the chat-room with `TestConnection`); consumes the `Connection[F]` type + linearity pass of [ADR 0130](0130-held-resource-linearity.md).
- **Relates:** [ADR 0077](0077-service-protocol-on-header.md) (`service … from <protocol>`, moved to the header so it generalises — `WebSocket(in:, out:)` is that generalisation); [ADR 0079](0079-protocols-closed-set.md) (the protocol set is closed; this adds one); the actor track (the `by` clause + Bearer/None schemes the edge reuses); [ADR 0017](0017-platform-lock-per-deployment-unit.md) (the platform-lock that gates the deferred Workers target).

## Context

Slices 0–2 built the streaming primitives and the held-resource discipline with
no socket. The connection leg's protocol — `service <Name> from WebSocket(in:,
out:)` — is the track's safety boundary: a wrong shape lets a client reach an
agent unauthenticated. The Workers production mapping (Durable Object
hibernatable WebSockets) is also the largest single emission task in the track.
So slice 3 is split: **3a (here)** lands the protocol surface, the
security-critical checker rules, and a **runnable bundle vertical** against
`TestConnection`; **3b** lands the Workers hibernatable upgrade with its own
focused review.

## Decisions

- **D1 — the protocol surface.** `ServiceProtocol::WebSocket { in_type, out_type }`
  on the service header (`WebSocket` a contextual identifier); a `HandlerKind::Open`
  for `on open`. The service holds **exactly one** `on open`
  (`bynk.service.websocket_open_arity`); inbound frames are the agent's typed
  messages, not service handlers. The `on open` body receives a synthetic,
  framework-supplied **owned `connection: Connection[out]`** binding (injected at
  check and emit), governed by the slice-2 linearity pass — it must be disposed
  (transferred to an agent), and an undisposed connection is `bynk.held.leak`.

- **D2 (the security crux) — edge auth before accept, `by` mandatory.** Like HTTP,
  a WebSocket upgrade has **no safe default actor** (`default_actor` → `None`); an
  `on open` without `by` is a compile error (a WebSocket-specific message: "the
  upgrade authenticates at the edge before accepting the connection — there is no
  anonymous upgrade"). The connection is minted only after the actor verifies;
  accept-then-authenticate is unrepresentable.

- **D3 (Q8, the carrier's static half) — the WS boundary admits `None`/`Bearer`,
  rejects `Signature`.** `scheme_admissible(WebSocket, …)` admits anonymous and
  Bearer and **rejects `Signature`** (`bynk.actor.scheme_not_admissible`): a
  browser `WebSocket` cannot set an `Authorization` header, so the Bearer token is
  read from the `Sec-WebSocket-Protocol` subprotocol (the one header a browser can
  set), and HMAC-over-body has no body on a handshake. The *runtime* read of the
  subprotocol is part of the Workers upgrade (3b); 3a settles the type-level
  admissibility.

- **D4 — the bundle vertical: `TestConnection`, no Durable Object.** On the bundle
  target the `on open` handler lowers to a directly-callable
  `open(connection, …params, deps)` surface method; the runtime ships a
  **`TestConnection`** implementing `Connection<F>` as a **capture-and-inspect**
  channel (`sent: F[]`, `closed`). A test drives `open` with a `TestConnection` and
  asserts the held connection flowed through — proven by a behaviour test where the
  `on open` handler sends a welcome frame (captured) before transferring the
  connection to the Room agent (the §20 chat-room, running under node).

- **D5 — the Workers target is platform-locked off until 3b.** A `from WebSocket`
  service built with `--target workers` is rejected
  (`bynk.target.websocket_workers_unsupported`) — the Durable Object hibernatable
  mapping (the upgrade, `acceptWebSocket`, `serializeAttachment` re-association
  Q7, `webSocketMessage` frame dispatch) is slice 3b. Bundle is the develop-and-test
  target; this is a coherent, runnable increment, not a half-feature.

## Consequences

- The §20 chat-room **type-checks and runs** on bundle: `on open` authenticates,
  receives an owned `Connection`, sends on it, and transfers it into a `Map[UserId,
  Connection]` agent — all under the linearity discipline; the negative fixtures pin
  the security rules (no `by`, `Signature` at WS, leak, Workers-target).
- The deferred, named **slice 3b**: the Workers Durable Object hibernatable upgrade
  — `WebSocketPair`, the subprotocol auth read (D3's runtime half), `acceptWebSocket`
  into the addressed DO, `serializeAttachment` re-association (Q7), and the inbound
  `webSocketMessage` → `in:`-decode → agent-handler dispatch. It removes the D5
  platform-lock and carries its own `/security-review`.
- Also deferred (with the slice-4 closure): the **held-aware iteration borrow
  surface** (`forEach`/`parTraverse` lending `&Connection` refs — broadcast to all
  connections), which ADR 0130 left for the pattern that needs it.
- The proposal `v0.103-from-websocket-protocol.md` is **retained** until 3b ships,
  since it is the direction for the whole slice 3; 3a consumes its bundle half.
