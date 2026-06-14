# Process a queued message

**Goal:** consume messages from a queue — sending emails, processing uploads,
fanning out work — one message at a time, with automatic retry on failure.

Queue handlers go in a `service` inside a `context`. Each names a queue (bare,
after `queue`), takes the message as its single parameter, and returns
`Effect[Result[(), E]]`.

## Consume a message

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

The `message` parameter is deserialised from the queue body before the handler
runs — a malformed message is retried, so the body always sees a valid value.

## Acknowledge or retry

The result decides the message's fate: `Ok(())` acknowledges it (done);
`Err(e)` retries it. You never call an ack API — return the verdict and the
framework routes it. Map a domain failure to `Err`:

```karn
type SendError = enum { Transient, Permanent }

service outbox {
  on queue "outbound-email" (message: EmailJob) -> Effect[Result[(), SendError]] {
    Err(Transient)
  }
}
```

Both `Err` variants retry; a message that keeps failing eventually hits the
queue's dead-letter policy (configured outside Karn).

## Use a capability

A queue handler reaches the outside world through `given`, like any handler:

```karn
  on queue "outbound-email" (message: EmailJob) -> Effect[Result[(), String]] given Smtp {
    let _ <- Smtp.send(message.to, message.subject)
    Ok(())
  }
```

## Build and run

Queue services compile to a Cloudflare Worker with `--target workers`; each
queue becomes a `[[queues.consumers]]` binding in the generated
`wrangler.toml`. See
[Target Cloudflare Workers](../projects-build-and-deployment/cloudflare-workers.md).

## Related

- Reference: [Queue](../../reference/queue.md).
- Reference: [Cron](../../reference/cron.md) — the sibling time-driven handler.
