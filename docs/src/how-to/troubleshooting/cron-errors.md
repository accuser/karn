# `karn.cron.*` errors

`on cron` handlers run on a schedule and have a fixed shape: no parameters, a
five-field schedule, and an `Effect[Result[(), E]]` return. These are the common
errors when that shape is broken.

## `karn.cron.has_params`

```text
[karn.cron.has_params] `on cron` handlers take no parameters
```

**Cause:** you declared a parameter on a cron handler. A scheduled trigger
carries no payload.

**Fix:** remove the parameters. If the body needs the current time, use the
`Clock` capability via `given`.

## `karn.cron.invalid_schedule`

```text
[karn.cron.invalid_schedule] cron expression `every day` must have exactly five whitespace-separated fields
```

**Cause:** the schedule string is not a five-field cron expression.

**Fix:** write five fields — `minute hour day-of-month month day-of-week`. For
example, `"0 0 * * *"` (midnight daily) or `"*/15 * * * *"` (every 15 minutes).

## `karn.cron.return_not_effect_result`

```text
[karn.cron.return_not_effect_result] `on cron` handler must return `Effect[Result[(), E]]`
```

**Cause:** the return type isn't `Effect[Result[(), E]]` — the `Ok` payload must
be unit `()`.

**Fix:** return `Effect[Result[(), E]]`; use `Ok(())` on success and `Err(e)` on
a domain failure.

## Other cron errors

- `karn.cron.duplicate_schedule` — two cron handlers in the context declare the
  same schedule. Give each a distinct expression.
- `karn.parse.cron_in_agent` — `on cron` was placed in an `agent`. Scheduled
  tasks belong in a `service`.

## Related

- [Run a task on a schedule](../cron/handle-cron-trigger.md)
- Reference: [Cron](../../reference/cron.md)
