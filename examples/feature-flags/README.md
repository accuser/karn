# Feature flags

A tiny feature-flag service: **anyone may read** a flag, **only an editor may
write** one. The flags live in Workers KV as JSON.

What it shows:

- **Two actors on one service** — public reads declare `by Visitor`; writes
  declare `by e: Editor`, a `Bearer` user carrying an `editor` claim. A missing
  token is `401`, a non-editor token `403`, both enforced at the boundary.
- **The KV surface** — `get` / `put` / `delete`, plus `list(Some("flag:"))` to
  enumerate keys by prefix.
- **The typed JSON codec** — flags are stored with `Json.encode` and read back
  through `Json.decode[Flag]`; a corrupt value surfaces as a `500`, never a
  silent `undefined`.
- **List combinators** — `uses bynk.list` brings `map` into scope to strip the
  key prefix back to bare flag names.

## Layout

```text
feature-flags/
├── bynk.toml
└── src/
    └── flags.bynk      # context flags — the HTTP service
```

## Run it

```sh
# writes need an AUTH_JWT_SECRET — supply a local one through the passthrough
bynk dev -- --var AUTH_JWT_SECRET:dev-secret
```

From anywhere inside the project, `bynk dev` compiles, picks the `flags` worker,
and serves it on `http://localhost:8787` in local mode — KV is simulated, so
there's nothing to provision first. Then:

```sh
# public read
curl localhost:8787/flags
# []  (nothing yet)

# write requires an editor JWT signed with AUTH_JWT_SECRET and an "editor" claim
curl -XPUT localhost:8787/flags/new-dashboard \
  -H "Authorization: Bearer $EDITOR_JWT" \
  -d '{"enabled":true,"description":"the redesigned dashboard"}'

curl localhost:8787/flags/new-dashboard
# {"enabled":true,"description":"the redesigned dashboard"}

curl localhost:8787/flags
# ["new-dashboard"]
```

*Under the hood,* `bynk dev` compiles to `out/workers/flags/` and runs
`wrangler dev` there. To **deploy** for real: `npx wrangler deploy`, set the real
secret with `npx wrangler secret put AUTH_JWT_SECRET`, and create the KV
namespace (`npx wrangler kv namespace create KV`, then paste the id into
`wrangler.toml`).
