# 0129 — streaming HTTP response: a `Streamed` `HttpResult` payload shape and a `Streaming` (200) variant carrying a `Stream[String]`, lowered to an SSE (`text/event-stream`) body; streamed responses are 200-only

- **Status:** Accepted (real-time track, slice 1; 2026-06-27).
- **Provenance:** the second slice of the real-time / WebSocket feature track (`design/tracks/websocket.md`), authored with its slice. Consumes proposal `design/proposals/v0.101-streaming-http-response.md`; settles that track's **Q2** (the streaming return shape, reconciled with ADR 0126) — and narrows it (D2).
- **Realises:** the streaming leg's early payoff — the first end-to-end consumer of `Stream[T]`, on the existing `from http` protocol with no socket, no `Connection`, and no Durable Object.
- **Relates:** [ADR 0128](0128-stream-value-over-time-primitive.md) (`Stream[T]` — the value-over-time primitive consumed here); [ADR 0126](0126-httpresult-rfc9110-status-vocabulary.md) (the `HttpResult` payload-shape registry this extends with one shape, exactly as 0126 D2 added `Location`).

## Context

`Stream[T]` (ADR 0128) shipped settled but with no consumer — it constructed in
memory and drained to a list. ADR 0126 made `HttpResult` a registry of
status-bearing variants over a closed set of payload **shapes**
(`Value`/`Message`/`None`/`Location`), each shape realised by dedicated variant
rows and extended at exactly three exhaustive sites (construction-check,
pattern-binding, the runtime status map). A streamed HTTP body is the natural
first consumer of `Stream[T]` and a natural fifth shape — so this slice gives the
primitive its first real use by extending 0126's machinery by one shape.

## Decisions

- **D1 — a `Streamed` payload shape realised by one dedicated `Streaming` (200)
  variant.** `HttpVariantPayload` gains a `Streamed` arm carrying a
  `Stream[String]`; `HTTP_VARIANTS` gains one row, `Streaming` (status 200). This
  follows 0126 D2's `Location` precedent (a shape realised by dedicated
  status-bearing rows), and is **rejected** as either a polymorphic `Ok` (which
  would break 0126's one-variant-one-shape model and the registry-driven dispatch
  that rests on it) or a status-less peer constructor. The three exhaustive arms
  extend once each — construction (`check_http_variant`: expects one
  `Stream[String]` argument, returns `HttpResult[()]` like `Location`/`Message`),
  pattern-binding (`variants_of`: binds `stream: Stream[String]`), and the runtime
  status map (`httpResultToResponse`: a `Streaming` case). No other site changes.

- **D2 — streamed responses are 200-only, which sharpens the track's Q2.** The
  track's Q2 speculated "a streamed `200` *and a streamed error* are both real."
  At the HTTP level they are not symmetric: **a response commits its status line
  and headers before the first body chunk**, so once streaming begins the status
  is already `200` and cannot change. The two real failure modes are handled where
  they occur:
  - **pre-stream failure** (auth, validation, not-found) — return an ordinary
    non-streamed variant *instead* of `Streaming`. These are `None`/`Message`
    shape, i.e. `HttpResult[()]`, so they coexist with `Streaming` in the **same
    handler** with no type conflict;
  - **mid-stream failure** — an **in-band outcome** the producer carries: build a
    `Stream[Result[String, E]]` and `.map` it to `Stream[String]`, encoding an
    `Err` as an error event, because the HTTP status is already sent (ADR 0128 D4's
    outcome-vs-fault split, applied upstream of `Streaming`).

  So one `Streaming` (200) variant is the complete v1 surface; a streamed
  `202 Accepted` later is one registry row.

- **D3 — the body is a `Stream[String]`, SSE-framed; each element is one event.**
  The runtime frames each element as `data: <element>\n\n` (a multi-line element
  becomes multiple `data:` lines), content-type `text/event-stream`,
  `cache-control: no-cache`. A structured `SseEvent` record (named
  `event`/`id`/`retry` fields) is a **named follow-on**, not v1 — a `String`
  element is the ergonomic minimum and is wire-encodable, so it stays inside slice
  0's "only `Stream[Chunk]`" scope (ADR 0128 D5) and does not force the deferred
  element-semantics call.

- **D4 — framing lives in the runtime, shared by both copies.** The SSE framing is
  a `sseResponse` helper beside `httpResultToResponse` in the runtime
  (`bynk-emit/runtime/src/http.ts`, the source of truth, regenerated into the
  shipped `bynk-emit/src/emitter/runtime.ts` by the existing bundler/drift guard) —
  not emitted inline like the `Stream` *combinators* (ADR 0128 D6), because
  `Response`-construction already lives in the runtime and is already imported by
  every http-handling file. It wraps the `AsyncIterable<string>` in a
  `ReadableStream<Uint8Array>`, a Web standard that runs unchanged on **Workers and
  Node**; the emitter dispatch (`httpResultToResponse`) is unchanged.

## Consequences

- A `from http` handler returns `Streaming(stream)` and lowers to a streaming
  `text/event-stream` `Response` on both targets, with no DO and no platform-lock.
  Proven on the generated code: the framing produces exactly
  `data: tick-1\n\ndata: multi\ndata: line\n\n` under node, and a streaming handler
  type-checks under `tsc --strict`.
- A streaming handler and a pre-stream `NotFound`/`Unauthorized` branch coexist in
  one handler under `HttpResult[()]` (the closure proof for D2), exercised by
  fixture `234_http_streamed_response`.
- The connection leg (slices 2–4) is independent — it realises `Held`/`Connection`
  linearity and the `from WebSocket` protocol, the other "real-time" mechanism the
  track keeps deliberately distinct from `Stream[T]`.
- Deferred and named: a structured `SseEvent` type (D3), a streamed `202` (D2), and
  a generic `Stream[T]` body with per-element JSON encoding (vs the v1
  `Stream[String]`) — each a later slice behind its own ADR.
