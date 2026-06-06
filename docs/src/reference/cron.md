# Cron

Cron handlers run on a schedule. Like HTTP handlers, they are declared in a
`service` inside a `context`.

## Handler form

```karn
on cron("<schedule>") () -> Effect[Result[(), E]] {
  …
}
```

- **Schedule:** a standard five-field cron expression
  (`minute hour day-of-month month day-of-week`) as a string literal. It must
  have exactly five whitespace-separated fields, or
  `karn.cron.invalid_schedule`.
- **Parameters:** none — a scheduled trigger carries no payload
  (`karn.cron.has_params`). Reach for the `Clock` capability if the body needs
  the current time.
- **Return type:** must be `Effect[Result[(), E]]` for some error type `E`
  (`karn.cron.return_not_effect_result`).
- **Placement:** only inside a `service`, never an `agent`
  (`karn.parse.cron_in_agent`).

No two cron handlers in a context may declare the same schedule
(`karn.cron.duplicate_schedule`).

## Failure

A cron run has no retry channel. Returning `Ok(())` completes the run silently;
returning `Err(e)` logs `e` and completes. Map a domain failure to `Err` the
same way an HTTP handler maps it to an `HttpResult` error variant — the mapping
stays visible in the handler body.

## Example

```karn
context reaper

service sweeper {
  on cron("*/5 * * * *") () -> Effect[Result[(), String]] {
    Ok(())
  }
}
```

## Emission

`on cron` handlers compile to the Worker's `scheduled` entry point on the
`--target workers` target, and every schedule is aggregated into the
`[triggers]` table of the generated `wrangler.toml`. See [emission](emission.md)
and [Target Cloudflare Workers](../how-to/projects/cloudflare-workers.md).
