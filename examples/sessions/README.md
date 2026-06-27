# Sessions

A live-session store backed by a **`Cache`** — a `Map` whose entries expire on
their own.

What it shows:

- **A `Cache` store with `@ttl`** — `live: Cache[Token, UserId] @ttl(30.minutes)`.
  A `put` (re)starts the entry's lifetime, an entry past its TTL reads as `None`,
  and `size` counts only live entries — expiry without a sweep.
- **Honest time as an effect** — eviction consults the clock, so every cache op
  *except* `remove` declares `given Clock`. The time dependency is visible in the
  signature, and a mocked clock would make expiry deterministic.
- **Refined boundary types** — `Token` (non-empty, bounded) and `UserId`
  (non-empty) carry their constraints, so a malformed token is rejected at the
  boundary before any cache lookup runs. Those constraints live in
  `commons tokens`.

> **No `bynkc test` here.** Like [`event-log`](../event-log/) and
> [`webhook-relay`](../webhook-relay/), the cache is platform-clock-effectful, and
> the platform `Clock` has no in-test substitute
> ([#291](https://github.com/accuser/bynk/issues/291)). The `Token`/`UserId`
> boundary is still type-checked by `bynkc check`; the expiry behaviour is
> exercised under `bynk dev`.

## Layout

```text
sessions/
├── bynk.toml
└── src/
    ├── tokens.bynk     # commons tokens — Token + UserId refined types
    └── sessions.bynk   # context sessions — the Cache-backed agent + HTTP service
```

## Check

```sh
bynkc check src      # type-check, no output
```

## Run it

```sh
bynk dev
```

`bynk dev` compiles, picks the `sessions` worker, and serves it on
`http://localhost:8787` in local mode — the Durable Object is simulated. Then:

```sh
curl -XPOST localhost:8787/sessions -d '{"token":"s_abc123","user":"u_42"}'
# "ok"  (HTTP 201)

curl localhost:8787/sessions/s_abc123
# "u_42"

curl localhost:8787/sessions
# 1                                  (live session count)

curl -XPOST localhost:8787/sessions/s_abc123/logout
# (HTTP 204)
```

A token resolves to its user until its 30-minute TTL lapses, after which
`GET /sessions/:token` returns a `404`.

*Under the hood,* `bynk dev` compiles to `out/workers/sessions/` and runs
`wrangler dev` there. **Deploy** with `npx wrangler deploy` from that directory.
