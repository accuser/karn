# Queue

Queue handlers consume messages from a named queue. Like HTTP and cron
handlers, they are declared in a `service` inside a `context`, with the queue
name sitting bare after the handler kind.

## Handler form

```karn
on queue "<name>" (message: T) -> Effect[Result[(), E]] {
  …
}
```

- **Name:** the queue this consumer binds to, as a string literal bare after
  `queue`. It must be non-empty (`karn.queue.invalid_name`).
- **Parameter:** exactly one — the message (conventionally named `message`), of
  any wire-deserialisable type. Anything else is `karn.queue.bad_params`. The
  message is deserialised from the queue body before the handler runs; a
  malformed message is retried.
- **Return type:** must be `Effect[Result[(), E]]` for some error type `E`
  (`karn.queue.return_not_effect_result`).
- **Placement:** only inside a `service`, never an `agent`
  (`karn.parse.queue_in_agent`).

No two queue handlers in a context may consume the same queue
(`karn.queue.duplicate_consumer`).

## Acknowledgement and retry

Each message is acknowledged or retried by the outcome:

- `Ok(())` — **acknowledge** the message; it is removed from the queue.
- `Err(e)` — **retry** the message (it is redelivered; persistent failures hit
  the queue's dead-letter policy).

The ack/retry is implicit from the result, so a handler never calls an ack API
itself — it returns a verdict and the framework routes it. Map a domain failure
to `Err` the same way an HTTP handler maps it to an `HttpResult` error variant.

## Example

```karn
context mailer

type EmailJob = {
  to:      String,
  subject: String,
}

service outbox {
  on queue "outbound-email" (message: EmailJob) -> Effect[Result[(), String]] {
    Ok(())
  }
}
```

## Emission

`on queue` handlers compile to the Worker's `queue` entry point on the
`--target workers` target (dispatching on `batch.queue`, deserialising each
message, acking on `Ok` / retrying on `Err`), and every queue becomes a
`[[queues.consumers]]` binding in the generated `wrangler.toml`. See
[emission](emission.md) and
[Target Cloudflare Workers](../how-to/projects/cloudflare-workers.md).
