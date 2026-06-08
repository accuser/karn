# Karn v0.10 Grammar — Background Processing (`on cron`, `on queue`)

A delta specification introducing two new handler kinds: **`on cron`** (scheduled
tasks) and **`on queue`** (queue consumers). Together with v0.9's `on http`, these
complete the inbound surface of a Cloudflare Workers application: HTTP requests,
scheduled triggers, queue messages, plus internal cross-context calls.

Read the earlier specs first — `karn-mvp-grammar.md` through
`karn-mvp-grammar-v0.9.4.md`, plus `karn-runtime-spec.md`. The v0.10 compiler
accepts every v0–v0.9.4 program unchanged; all prior fixtures must continue to
pass (the addition is purely additive, two new `HandlerKind` variants).

This is a **design draft for review**. Choices marked **[DECISION]** are the
language-defining calls to settle before implementation. This spec is sliced into
two independently-landable parts; see [DECISION 1].

---

## 1. Scope

### Slicing — **[DECISION 1]**

`on cron` and `on queue` are siblings of `on http` and reuse the same machinery,
but they are independent of each other. To honour the "smaller increments"
preference while keeping the roadmap numbering intact, v0.10 ships as **two
slices, landed in order**:

- **v0.10a — `on cron`** (this lands first). Smallest possible: a scheduled
  trigger with no payload and no per-message semantics. Exercises the new
  handler-kind plumbing end to end (grammar → checker → workers `scheduled`
  entry → `wrangler.toml [triggers]`), plus its tooling and docs.
- **v0.10b — `on queue`** (lands after 10a). Adds message deserialisation, the
  Worker `queue` entry, ack/retry semantics, and the `[[queues.consumers]]`
  binding.

**Recommendation: ship as 10a then 10b under the single `v0.10` number** (commit
messages `v0.10a` / `v0.10b`, as `v0.9.4 slice B` did). The alternative —
splitting into separate `v0.10` (cron) and `v0.11` (queue) versions and
renumbering the downstream roadmap (state machines → v0.12, …) — is also viable
but churns the roadmap. This document specifies both slices in full; 10a is
independently complete and can land alone.

### In scope for v0.10

- **`on cron "<expr>" (at: Int?) -> Effect[Result[(), E]]`** — scheduled tasks.
  The cron expression sits bare after `cron` (mirroring `on http`'s bare path);
  the handler may take an optional single `Int` parameter that receives the
  scheduled fire time (Unix epoch milliseconds). The expression maps to a
  `wrangler.toml` `[triggers] crons` entry. (10a)
- **`on queue "<name>" (message: T) -> Effect[Result[(), E]]`** — queue
  consumers. The handler processes one message; `Ok(())` acknowledges it, `Err`
  triggers a retry (Cloudflare Queue semantics). The framework manages the batch.
  The queue name maps to a `[[queues.consumers]]` binding. (10b)
- **Worker `scheduled` and `queue` entry-point aggregation** — all `on cron`
  handlers in a context aggregate into the Worker's `scheduled` handler; all
  `on queue` handlers into its `queue` handler, alongside v0.9's `fetch`.
- **Reuse of `Result[(), E]`** as the handler return shape — no new built-in
  result type (contrast `HttpResult`); see [DECISION 2].

### Out of scope for v0.10 (deferred)

- **Queue *producers*** — emitting messages onto a queue (`Queue.send`) is a
  capability, not a handler kind; deferred. v0.10 only *consumes*.
- **Batch-level queue access** — a handler sees one `message: T`; per-batch
  handlers are deferred ([DECISION 5]). See §4.4 for the intended future shape
  (a verdict-mapping form inspired by SvelteKit's `query.batch`) and why it is
  blocked on features Karn hasn't shipped yet.
- **Explicit ack/retry control** — ack is implicit from `Ok`/`Err`
  ([DECISION 6]); message-level `ack()`/`retry()`/`retryAll(delaySeconds)` come
  later.
- **Deep cron-expression validation** — only light structural validation in
  v0.10 ([DECISION 4]).
- **Richer cron `event` payload** — beyond the scheduled time (now an optional
  `Int` param), the rest of the platform's scheduled-event metadata (the matched
  cron string, etc.) is not surfaced in v0.10. (There is no built-in `Clock`
  capability — the scheduled-time parameter is how a cron handler reads the time.)
- **Alarms** (agent-addressed timers) — a separate, agent-side mechanism; not a
  service handler kind. Deferred.
- **Dead-letter configuration**, queue producer bindings, consumer tuning
  (`max_batch_timeout`, `max_retries`) beyond sane defaults — emitted as defaults,
  not yet Karn-configurable.

---

## 2. Updated lexical structure

### New reserved keywords

```
cron      queue
```

Both are handler-kind keywords, recognised in the `on cron …` / `on queue …`
position. Following the v0.9 precedent for `http`, they become reserved keyword
tokens (`TokenKind::Cron`, `TokenKind::Queue`). The cron expression and queue
name are ordinary `string-literal`s.

All other lexical rules are unchanged from v0.9.4.

> Implementation note: `lexer.rs` currently has `#[token("http")] Http`
> (`lexer.rs:116`). Add `#[token("cron")] Cron` and `#[token("queue")] Queue`
> alongside it. Both must be added to the keyword-reference generator's set so the
> generated `reference/keywords.md` picks them up.

---

## 3. Updated grammar

### 3.1 The new handler kinds

```
handler-block ::= doc-block? 'on' handler-kind handler-spec given-clause? block

handler-kind  ::= 'call'                          -- v0.5
                | 'http' http-method string-literal -- v0.9
                | 'cron'  string-literal            -- NEW v0.10a
                | 'queue' string-literal            -- NEW v0.10b

handler-spec  ::= '(' param-list? ')' return-spec?
```

The handler kind's configuration sits **bare** between the keyword and the
parameter list, uniformly across kinds: `http`'s is `METHOD "path"`, `cron`'s is
`"expr"`, `queue`'s is `"name"`. (An earlier draft wrapped the cron/queue string
in parentheses; the bare form is consistent with `on http`.)

Like `on http`, both new kinds live inside a `service` declaration and are
**service-only** — an `on cron`/`on queue` handler inside an `agent` is a syntax
error (mirroring `karn.parse.http_in_agent`). Services are the bounded context's
protocol adapters; cron firings and queue messages are protocol stimuli, so they
enter through services, exactly as HTTP does (design notes §4, §7).

### 3.2 `on cron` (10a)

```karn
service reaper {
  ---
  Expire stale reservations every five minutes.
  ---
  on cron "*/5 * * * *" (at: Int) -> Effect[Result[(), ReaperError]] given Reservations {
    -- handler body; `at` is the scheduled fire time (epoch ms)
  }
}
```

- The cron expression is a string literal in standard 5-field cron syntax
  (`minute hour day-of-month month day-of-week`), the format Cloudflare's
  `[triggers] crons` accepts.
- The parameter list holds **at most one parameter**, of type `Int` — the
  scheduled fire time in Unix epoch milliseconds (from `event.scheduledTime`).
  Cron has no built-in clock, so this is how a handler reads the time, and it is
  the exact schedule-aligned instant (better than "now" for bucketing or
  idempotency). More than one parameter, or a non-`Int` one, is a compile error
  (`karn.cron.bad_params`).
- The return type is `Effect[Result[(), E]]` for some error type `E`
  ([DECISION 2], [DECISION 3]).

### 3.3 `on queue` (10b)

```karn
service mailer {
  ---
  Send one queued email. Ok acknowledges; Err retries.
  ---
  on queue "outbound-email" (message: EmailJob) -> Effect[Result[(), SendError]]
      given Smtp {
    -- handler body
  }
}
```

- The queue name is a string literal (the Cloudflare queue this consumer binds
  to).
- The parameter list is **exactly one parameter** (conventionally named
  `message`, but the name is free), whose type is any wire-deserialisable type (a
  record, sum, refined, or opaque type — the same set v0.9's `body` accepts).
  Deserialisation reuses v0.8's wire-format machinery. Any other parameter count
  is a compile error (`karn.queue.bad_params`).
- The return type is `Effect[Result[(), E]]`. `Ok(())` acknowledges the message;
  `Err(_)` causes the runtime to retry it ([DECISION 6]).

### 3.4 Handler body semantics

Identical to v0.9 HTTP bodies: an effectful block returning `Effect[Result[(),
E]]`. All v0.5+ effectful rules apply (`<-`, `?`, capability calls); v0.7.1
auto-lift applies (a tail `Result[(), E]` lifts to `Effect[Result[(), E]]`); and
a tail `Ok(())` resolves to `Result.Ok` (there is no `HttpResult` in scope here,
so the v0.9 `Ok`/`HttpResult.Ok` disambiguation does not arise).

Because the success payload is unit, the common tail forms are `Ok(())` on success
and an explicit `Err(SomeError)` mapped from a domain failure — the same
Anti-Corruption mapping v0.9 uses at the HTTP boundary, here at the
cron/queue boundary.

### 3.5 Updated grammar — summary

```
handler-kind ::= 'call'
               | 'http' http-method string-literal
               | 'cron'  string-literal
               | 'queue' string-literal
```

No other grammar changes. No new predeclared types (`Result`, `()` are
pre-existing).

---

## 4. Updated static semantics

### 4.1 Cron handler validation (10a)

For `on cron "expr" (at: Int?) -> Effect[Result[(), E]] given Caps { body }`:

1. The handler is inside a `service`, not an `agent`
   (`karn.parse.cron_in_agent`, enforced in the parser).
2. The parameter list holds at most one parameter, of type `Int`
   (`karn.cron.bad_params`).
3. The cron expression is structurally well-formed: a non-empty string of exactly
   five whitespace-separated fields (`karn.cron.invalid_schedule`). Deep
   per-field validation is deferred ([DECISION 4]).
4. The return type is `Effect[Result[(), E]]` for some `E`
   (`karn.cron.return_not_effect_result`).
5. The `given` clause is verified as for any handler (used ⊆ declared, declared ⊆
   used).

**Schedule uniqueness.** Within a context, no two `on cron` handlers may declare
the same expression (`karn.cron.duplicate_schedule`) — the generated `scheduled`
dispatcher routes on `event.cron`, so duplicates are ambiguous. Mirrors
`karn.http.duplicate_route`.

### 4.2 Queue handler validation (10b)

For `on queue "name" (message: T) -> Effect[Result[(), E]] given Caps { body }`:

1. The handler is inside a `service`, not an `agent`
   (`karn.parse.queue_in_agent`, enforced in the parser).
2. Exactly one parameter (any name), of a wire-deserialisable type
   (`karn.queue.bad_params`).
3. The queue name is a non-empty string (`karn.queue.invalid_name`).
4. The return type is `Effect[Result[(), E]]` for some `E`
   (`karn.queue.return_not_effect_result`).
5. The `given` clause is verified as for any handler.

**Consumer uniqueness.** Within a context, no two `on queue` handlers may bind the
same queue name (`karn.queue.duplicate_consumer`) — the generated `queue`
dispatcher routes on `batch.queue`. Mirrors `karn.http.duplicate_route`.

### 4.3 Cross-context calls don't reach cron/queue handlers

Like `on http`, the new kinds are platform-facing only. A cross-context `on call`
(v0.6) cannot invoke an `on cron` or `on queue` handler; they are triggered by the
runtime (the scheduler, the queue), not by sibling contexts.

### 4.4 Future direction: bulk queue processing (verdict-mapping)

**[DECISION 5/6 — DECIDED: per-message, implicit ack for v0.10b.]** Recorded
here because it shapes a later increment.

A queue consumer that processes one message per invocation cannot batch-optimise
(e.g. one bulk write for ten messages instead of ten writes). Cloudflare always
delivers a *batch*; the per-message form is framework sugar that loops it. The
two obvious alternatives both have a cost: exposing the raw batch
(`messages: …`) forces the handler to hand-call `ack()`/`retry()` per message —
a footgun against the idempotency discipline.

SvelteKit's [`query.batch`](https://svelte.dev/docs/kit/remote-functions#query.batch)
suggests a cleaner third shape. Its callback receives the whole batch, does the
bulk work, and **returns a per-item resolver** `(input, index) => output`; the
framework calls it for each input to route results back. `query.batch` solves a
*different* problem (outbound read-coalescing / N+1 — the framework *constructs*
the batch from many call sites), but its **shape transfers**: a queue handler
could receive the batch, process in bulk, and return a **per-message verdict**
(`Result[(), E]` each), with the framework acking the `Ok`s and retrying the
`Err`s — bulk efficiency *and* implicit, safe ack routing, no manual `ack()`.

This is deferred because it is **blocked on language features Karn has not
shipped**:
- The faithful form returns a resolver *closure* — Karn has no first-class
  closures.
- The fallback (return a positionally-aligned `List[Result[(), E]]`) needs
  generic `List[T]` — generics are still deferred from the MVP.

So v0.10b ships the **per-message form with implicit ack** (`Ok(())` → ack,
`Err` → retry). It is forward-compatible: a future *bulk queue processing*
increment can add the verdict-mapping form additively once closures and/or
generics land, without disturbing per-message handlers. "Conservative start;
extend when pressure emerges."

### Diagnostic codes introduced

| Slice | Code | Cause |
|---|---|---|
| 10a | `karn.parse.cron_in_agent` | cron handler declared inside an agent |
| 10a | `karn.cron.bad_params` | cron handler has >1 parameter, or a non-`Int` one |
| 10a | `karn.cron.invalid_schedule` | cron expression not five whitespace-separated fields |
| 10a | `karn.cron.duplicate_schedule` | two cron handlers with the same expression |
| 10a | `karn.cron.return_not_effect_result` | return type isn't `Effect[Result[(), E]]` |
| 10b | `karn.parse.queue_in_agent` | queue handler declared inside an agent |
| 10b | `karn.queue.bad_params` | not exactly one `message` parameter, or non-deserialisable type |
| 10b | `karn.queue.invalid_name` | empty queue name |
| 10b | `karn.queue.duplicate_consumer` | two queue handlers binding the same queue |
| 10b | `karn.queue.return_not_effect_result` | return type isn't `Effect[Result[(), E]]` |

All are added to the `diagnostics.rs` registry (with cause/fix text), which
auto-populates `reference/diagnostics.md` via `KARN_BLESS`.

---

## 5. Compilation to TypeScript

The new handlers compile into the same per-context surface as HTTP handlers (a
named method on the service object — `emitter.rs:1816-1875`, extend the
`kind_name` match at `:1821-1824`) and aggregate into the Worker's `export
default {}`. In **bundle mode**, as with v0.9 HTTP serving (§5.7 of v0.9), the
handler implementations are emitted but the aggregated `scheduled`/`queue` entry
points are **deferred** — cron/queue *serving* is a workers-mode concern; bundle
mode is for tests, where handlers are invoked directly.

### 5.1 Cron → the Worker `scheduled` handler (10a)

A new `scheduled(event, env, ctx)` method is added to `export default {}`
(alongside `fetch`) in `emitter/workers_entry.rs` (the object emitted at
`workers_entry.rs:88`). It dispatches on `event.cron`:

```typescript
export default {
  async fetch(request, env) { /* v0.9 router */ },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const surface = compose(env);
    switch (event.cron) {
      case "*/5 * * * *": {
        const result = await surface.cron_0(/* given deps */);
        if (result.tag === "Err") {
          console.error("cron */5 * * * * failed", result.error);
        }
        return;
      }
      default:
        return; // unknown schedule — no-op
    }
  },
};
```

- Generated handler method name: `cron_<index>` (or a sanitised slug of the
  expression). Add a `cron_handler_method_name(...)` beside
  `http_handler_method_name` (`emitter.rs:1711-1723`).
- A failing cron run has nowhere to retry to ([DECISION 3]); v0.10 **logs** the
  `Err` via `console.error` and returns. The handler still "completes" from the
  platform's view.
- `wrangler.toml` gains a `[triggers]` block aggregating every cron expression in
  the context (`emitter/wrangler.rs:16-55`, after the existing bindings at `:52`):

  ```toml
  [triggers]
  crons = ["*/5 * * * *"]
  ```

### 5.2 Queue → the Worker `queue` handler (10b)

A new `queue(batch, env, ctx)` method is added to `export default {}`. It
dispatches on `batch.queue`, deserialises each message, invokes the handler, and
maps `Ok`/`Err` to `ack`/`retry`:

```typescript
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
    const surface = compose(env);
    switch (batch.queue) {
      case "outbound-email": {
        for (const msg of batch.messages) {
          try {
            const message = deserialiseEmailJob(msg.body); // v0.8 wire-format
            const result = await surface.queue_0(message, /* given deps */);
            if (result.tag === "Ok") msg.ack();
            else { console.error("queue outbound-email failed", result.error); msg.retry(); }
          } catch (e) {
            console.error("queue outbound-email deserialise failed", e);
            msg.retry(); // malformed → retry; persistent failures hit the queue's DLQ policy
          }
        }
        return;
      }
      default:
        return;
    }
  },
```

- Generated handler method name: `queue_<index>`. Add
  `queue_handler_method_name(...)` beside the HTTP one.
- Deserialisation reuses the v0.8 wire-format path (the same one v0.9's `body`
  parameter uses); a deserialisation failure retries the message (it cannot be a
  400 — there is no caller to answer).
- `wrangler.toml` gains a consumer binding per queue
  (`emitter/wrangler.rs`, after `:52`):

  ```toml
  [[queues.consumers]]
  queue = "outbound-email"
  max_batch_size = 10
  ```

### 5.3 Runtime additions

Cron and queue **reuse `Result<T, E>`** (already in `runtime.ts`,
`emitter.rs:54-285`) — no new result type. The only possible runtime addition is
minimal TypeScript ambient types for `ScheduledController` / `MessageBatch`, which
are supplied by `@cloudflare/workers-types`; the generated `tsconfig`/`d.ts`
already covers Worker globals, so **no runtime.ts change is expected**. Confirm
during 10b that `tsc --strict` resolves `MessageBatch`/`ScheduledController`; if
not, add a minimal ambient declaration to the emitted types (bounded work).

---

## 6. New test corpus

Fixture frontier today: positive `145`, negative `109`. v0.10 starts at positive
`146`, negative `110`. Project-form fixtures with handlers use `target.txt =
workers` to exercise the Worker entry generation, and the `tsc_verify` stage
gates emitted output under `tsc --strict`.

### Slice 10a — cron

Positive:
```
146_cron_simple/            -- one on cron, Ok(()) tail               [workers]
147_cron_with_given/        -- cron handler using a capability        [workers]
148_cron_multiple/          -- two cron handlers, distinct schedules  [workers]
149_cron_acl_error/         -- domain error mapped to Err             [workers]
150_cron_scheduled_time/    -- handler takes the `Int` scheduled time [workers]
```
Negative:
```
110_cron_bad_params/        -- cron handler with a non-`Int` parameter
111_cron_in_agent/          -- on cron inside an agent
112_cron_invalid_schedule/  -- malformed expression (e.g. "every day")
113_cron_duplicate_schedule/-- two handlers, same expression
114_cron_bad_return/        -- return type not Effect[Result[(), E]]
```

### Slice 10b — queue

Positive:
```
150_queue_simple/           -- one on queue, message deserialised     [workers]
151_queue_with_given/       -- queue handler using a capability       [workers]
152_queue_multiple/         -- two consumers, distinct queues         [workers]
153_full_jobs_service/      -- worked example (cron + queue together) [workers]
```
Negative:
```
115_queue_bad_params/       -- not exactly one `message` parameter
116_queue_in_agent/         -- on queue inside an agent
117_queue_invalid_name/     -- empty queue name
118_queue_duplicate_consumer/ -- two handlers, same queue name
119_queue_bad_return/       -- return type not Effect[Result[(), E]]
```

### Worked example (10b): a jobs context with cron + queue

```karn
---
A background-jobs context: a cron that sweeps expired reservations, and a
queue consumer that sends queued notifications.
---
context ops.jobs

uses commons.ids

type ReaperError = enum { StorageUnavailable }
type SendError   = enum { Transient, Permanent }

type Notification = {
  to:      String,
  subject: String,
  body:    String,
}

service sweeper {
  on cron "*/5 * * * *" () -> Effect[Result[(), ReaperError]] given Reservations {
    let expired <- Reservations.expireStale()
    Ok(())
  }
}

service notifier {
  on queue "notifications" (message: Notification) -> Effect[Result[(), SendError]]
      given Email {
    let sent <- Email.send(message.to, message.subject, message.body)
    match sent {
      Ok(_)  => Ok(())
      Err(e) => match e {
        Throttled => Err(Transient)   -- Err → retry
        Rejected  => Err(Permanent)   -- Err → retry (DLQ after max retries)
      }
    }
  }
}
```

Exercises: a cron handler and a queue handler in one context; capability use in
both; the `Ok(())`/`Err(_)` ack-retry mapping; the aggregated `scheduled` +
`queue` + (no `fetch`, none declared) Worker entry; and `[triggers]` +
`[[queues.consumers]]` in the generated `wrangler.toml`.

---

## 7. Implementation notes

### 7.1 Where new code goes (file:line anchors from the current tree)

| Area | File | Change |
|---|---|---|
| Keywords | `lexer.rs:116` | add `Cron`, `Queue` tokens beside `Http` |
| AST | `ast.rs:367` | add `HandlerKind::Cron { expr }`, `Queue { name }` |
| Parser | `parser.rs:3518` (`parse_handler`), branch near `:3553` / note at `:3566` | parse `on cron "expr"` and `on queue "name"`; service-only guard like `:3525` |
| Validation | `project.rs:3118` (`validate_http_handler` sibling) | add `validate_cron_handler`, `validate_queue_handler` |
| Uniqueness | `project.rs:2836` (route-dedup map) | add schedule-dedup and consumer-dedup maps |
| Surface emit | `emitter.rs:1816` (`emit_service`), match at `:1821` | add `Cron`/`Queue` `kind_name` arms; new `*_handler_method_name` fns near `:1711` |
| Worker entry | `emitter/workers_entry.rs:88` (`export default {}`) | add `scheduled`/`queue` methods + per-handler dispatch (sibling of `emit_http_route_dispatch` at `:173`) |
| wrangler | `emitter/wrangler.rs:52` | emit `[triggers] crons` and `[[queues.consumers]]` |
| Diagnostics | `diagnostics.rs` registry | register the 10 new `karn.cron.*` / `karn.queue.*` codes with cause/fix |

### 7.2 Risk areas

- **Empty parameter list for cron.** The parser already handles `()`; ensure the
  checker rejects a non-empty list with a clear message rather than falling
  through to HTTP-style param binding.
- **`Ok(())` resolution.** With no `HttpResult` in scope, `Ok(())` must resolve to
  `Result.Ok` cleanly. This is the ordinary path, but worth a fixture
  (`146_cron_simple`) since v0.9 made `Ok` overload-sensitive.
- **Worker entry with no `fetch`.** A context with only cron/queue handlers
  generates an `export default {}` with `scheduled`/`queue` but **no `fetch`** —
  confirm `emit_worker_entry` doesn't assume at least one HTTP route, and that the
  emitted object is still valid (Cloudflare allows a Worker with only
  `scheduled`/`queue`).
- **wrangler `[triggers]` vs `[[triggers]]`.** Cloudflare uses a single
  `[triggers]` table with a `crons` array, not a `[[triggers]]` array-of-tables.
  Get the TOML shape right or deployment silently ignores the crons.
- **`tsc --strict` on Worker globals.** `MessageBatch` / `ScheduledController`
  come from `@cloudflare/workers-types`; verify the emitted `tsconfig` pulls them
  in (§5.3).

### 7.3 What "done" looks like (per slice)

1. All prior fixtures pass (regression).
2. New fixtures pass (10a: 4 positive / 5 negative; 10b: 4 positive / 5 negative).
3. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` clean; emitted
   output passes `tsc --strict` (`KARN_REQUIRE_TSC=1`).
4. The worked example compiles in workers mode with correct `wrangler.toml`.
5. **Tooling delta landed** (§8) and **docs delta landed** (§9) in the same
   commit as the slice — the new definition-of-done.

---

## 8. Tooling delta (NEW — required per slice)

Each slice updates the three editor-facing components and their docs in the same
commit. Most of this is small because cron/queue mirror `http`.

### 8.1 tree-sitter-karn

- `grammar.js` (`handler` choice + `http_handler` near lines 390–421): extend the
  `handler` choice to `choice($.call_handler, $.http_handler, $.cron_handler,
  $.queue_handler)`; add `cron_handler: $ => seq("on", "cron", field("schedule",
  $.string_literal), …)` and `queue_handler: $ => seq("on", "queue",
  field("name", $.string_literal), …)`.
- `queries/highlights.scm` (the `"http"` keyword at `:19`): add `"cron"` and
  `"queue"` to the handler-kind `@keyword` set.
- `test/corpus/`: add `v0.10.txt` with cron (10a) then queue (10b) parse cases;
  validate the karnc fixtures still parse to zero ERROR/MISSING.
- Regenerate `src/parser.c` etc. via `npx tree-sitter generate`; the
  `mdbook-karn-highlight` preprocessor then highlights cron/queue in the docs
  automatically (single source of truth).

### 8.2 vscode-karn (TextMate)

- `syntaxes/karn.tmLanguage.json` (`keyword.control` pattern at line ~37, which
  already lists `http`): add `cron` and `queue` to the alternation. No new scope
  needed — the schedule/name are ordinary strings, already highlighted. Bump the
  extension `version` to track the language (e.g. `0.10.x`).

### 8.3 karn-lsp

- No required change: diagnostics flow through `karnc::diagnose`, so the new
  `karn.cron.*`/`karn.queue.*` errors surface for free.
- **Optional polish:** extend `describe_service` (`symbols.rs:155`) so the outline
  reports handler kinds (e.g. "1 cron, 2 http"). Nice-to-have, not gating.

### 8.4 karn-fmt

- `fmt.rs` `format_handler` (~lines 888–920) is handler-kind-agnostic and
  re-prints from the AST; it needs an arm to print the cron expression / queue
  name string after the `cron`/`queue` keyword (mirroring how `http` prints its
  method + path). Add an idempotency fixture for each.

---

## 9. Documentation delta (NEW — required per slice)

Docs are current at v0.9.4; from v0.10 each slice ships its docs in the same
commit (the docs-delta discipline). The HTTP docs are the template throughout.

### 9.1 Slice 10a — cron

- **Reference:** new `docs/src/reference/cron.md` (model on `reference/http.md`) —
  the `on cron` form, the cron-expression format, the `Effect[Result[(), E]]`
  return shape, failure-is-logged semantics, emission (`scheduled` + `[triggers]`).
- **How-to:** new `docs/src/how-to/cron/handle-cron-trigger.md` — a task recipe
  (model on `how-to/http/handle-request.md`).
- **Troubleshooting:** short pages for the new diagnostics that warrant them
  (`karn.cron.bad_params`, `karn.cron.invalid_schedule`,
  `karn.cron.duplicate_schedule`).
- **SUMMARY.md:** wire the new pages into Reference and How-to.
- **Changelog:** add the v0.10a row to `reference/changelog.md`.
- **Generated pages:** after the compiler change, regenerate
  `reference/diagnostics.md` and `reference/grammar.md`
  (`KARN_BLESS=1 cargo test -p karnc --test diagnostics_registry` and
  `--test grammar_reference`), and `keywords.md` (`cron` is now a keyword).
- **Examples gate:** every fenced `karn` block compiles via `doc_examples.rs`; tag
  negative snippets `karn,fail` and pseudo-syntax `karn,ignore`.

### 9.2 Slice 10b — queue

- **Reference:** new `docs/src/reference/queue.md` — the `on queue` form, the
  `message` parameter and wire deserialisation, ack/retry-from-`Ok`/`Err`
  semantics, emission (`queue` + `[[queues.consumers]]`).
- **How-to:** new `docs/src/how-to/queue/handle-queue-message.md`.
- **Troubleshooting:** pages for `karn.queue.bad_params`,
  `karn.queue.duplicate_consumer`.
- **Tutorial (optional but recommended):** a new
  `tutorials/07-background-jobs.md` building the §6 jobs example end to end
  (cron + queue), extending the six-step spine. Decide whether to fold it in now
  or once both slices land.
- **SUMMARY.md / changelog / generated pages / examples gate:** as in 10a.

> Note: `reference/http.md`, `cron.md`, and `queue.md` could later be consolidated
> into one `reference/handlers.md` covering `call`/`http`/`cron`/`queue`. Keeping
> them separate for now mirrors the existing per-feature structure; revisit if the
> handler family grows.

---

## 10. Open decisions

1. **[DECISION 1] Slicing — DECIDED.** Ship `v0.10` as two ordered slices (10a
   cron, 10b queue) under one version number, cron first (commit messages
   `v0.10a` / `v0.10b`). No roadmap renumber.
2. **[DECISION 2] Result type — DECIDED.** Reuse `Effect[Result[(), E]]` for both;
   no new built-in result type (matches the v0.9 §8 preview, adds no runtime
   surface).
3. **[DECISION 3] Cron failure semantics — DECIDED (follows from D2).** Cron
   returns `Effect[Result[(), E]]`; since cron has no retry channel, an `Err` is
   logged and the run completes. Keeps the typed error for observability and
   matches queue's shape.
4. **[DECISION 4] Cron-expression validation depth.** Light structural check (five
   whitespace-separated fields) now (**recommended**) vs. full per-field cron
   grammar. *Recommend: light now; deepen in a later increment if needed.*
   *(Still open — low stakes; will proceed with light unless you say otherwise.)*
5. **[DECISION 5/6] Queue granularity & ack control — DECIDED.** Per-message with
   implicit ack (`Ok(())` → ack, `Err` → retry); the framework manages the batch.
   The verdict-mapping batch form inspired by SvelteKit `query.batch` (§4.4) is
   deferred to a future *bulk queue processing* increment, as it is blocked on
   first-class closures and/or generic `List[T]` — neither shipped.
6. **[DECISION 7] Tutorial timing.** Add the background-jobs tutorial during 10b
   vs. after both slices settle. *Recommend: after 10b lands, so it covers the
   full cron+queue picture. (Still open.)*

---

## 11. v0.11+ preview

After v0.10, Karn handles the full inbound surface of a Workers application:
HTTP, cron, queues, plus internal cross-context calls. Remaining roadmap:

- **v0.11:** State machines as sums.
- **v0.12:** Provider composition.
- **v0.13:** Refinement narrowing.
- **v0.14:** Sagas / compensation.
- **v0.15:** Cross-context capability resolution.
- **v0.16:** Multi-Worker integration testing.

Queue *producers* (`Queue.send` as a capability) are the natural follow-on to
v0.10b and slot in wherever capability-emission work next makes sense.
