# 2. Build a small HTTP service

In this tutorial we build a small HTTP service — a notes API with three
endpoints — and compile it to a ready-to-run Cloudflare Worker. Along the way
you will meet `context`, `service`, `on http` handlers, and `HttpResult`.

This builds on [Tutorial 1](01-first-program.md). You need `karnc` installed.

## Start a project

A service is more than one file's worth of output, so instead of compiling a
single file we work with a **project directory**. Create one:

```sh
mkdir notes-service
cd notes-service
```

Inside it, create `notes.karn`:

```karn
context notes

service api {
  on http GET "/ping" () -> Effect[HttpResult[String]] {
    Ok("pong")
  }
}
```

A few new things:

- `context notes` declares a **context** rather than a `commons`. Contexts are
  the unit Karn deploys — each becomes one Worker.
- `service api { … }` groups request handlers.
- `on http GET "/ping" ()` is a handler: it answers `GET /ping`, takes no
  parameters, and returns `Effect[HttpResult[String]]`.
- `Ok("pong")` is the response — an `HttpResult` whose `Ok` variant becomes a
  `200 OK` carrying `"pong"`.

> The file's name must match the context's name: `context notes` lives in
> `notes.karn`. The compiler uses the source layout to determine each unit's
> identity.

## Compile to a Worker

Compile the project, targeting Cloudflare Workers:

```sh
karnc compile . --output out --target workers
```

This writes a complete Worker under `out/`:

```text
out/
├── runtime.ts
├── tsconfig.json
└── workers/
    └── notes/
        ├── handlers.ts     # your handler logic
        ├── index.ts        # the Worker entry point + router
        ├── compose.ts      # dependency wiring
        └── wrangler.toml    # Cloudflare config
```

Open `out/workers/notes/handlers.ts` and find your handler:

```typescript
export const api = {
  async http_GET_ping(deps: {}): Promise<HttpResult<string>> {
    return HttpResult.Ok("pong");
  },
};
```

The routing lives in `index.ts`, which Cloudflare calls for every request:

```typescript
if (method === "GET" && path === "/ping") {
  const result = await surface.http_GET_ping();
  return httpResultToResponse(result, (v: any) => v as JsonValue);
}
```

You wrote the *what* (answer `GET /ping` with `"pong"`); `karnc` generated the
*how* (the router, the response encoding, the Worker scaffold).

## Accept a request body

Let us add an endpoint that creates a note from a JSON body. First we need types
for the request and the response. Update `notes.karn`:

```karn
context notes

type NewNote = {
  title: String,
}

type NoteView = {
  id: String,
  title: String,
}

service api {
  on http GET "/ping" () -> Effect[HttpResult[String]] {
    Ok("pong")
  }

  on http POST "/notes" (body: NewNote) -> Effect[HttpResult[NoteView]] {
    Created(NoteView { id: "note-1", title: body.title })
  }
}
```

`NewNote` and `NoteView` are **record types** — you will learn them properly in
[Tutorial 3](03-modelling-data.md). The new handler takes a special `body`
parameter typed as `NewNote`, and returns `Created(…)` — the `HttpResult`
variant for `201 Created`.

Recompile (`karnc compile . --output out --target workers`) and look again at
`handlers.ts`. Your handler is there:

```typescript
async http_POST_notes(body: NewNote, deps: {}): Promise<HttpResult<NoteView>> {
  return HttpResult.Created({ id: "note-1", title: body.title });
},
```

…and `karnc` has *also* generated a validator that parses and type-checks the
incoming JSON before your handler ever runs:

```typescript
export function deserialise_NewNote(json: JsonValue, path: string = "$"): Result<NewNote, BoundaryError> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return Err({ kind: "StructuralMismatch", path, expected: "object", actual: typeof json });
  }
  const obj = json as { [k: string]: JsonValue };
  if (typeof obj["title"] !== "string") {
    return Err({ kind: "StructuralMismatch", path: `${path}.title`, expected: "string", actual: typeof obj["title"] });
  }
  const __title = obj["title"];
  return Ok({ title: __title } as NewNote);
}
```

A request whose body is not a valid `NewNote` is rejected with `400` at the
boundary, so inside your handler `body` is always a well-formed `NewNote`.

## Add a path parameter

Finally, an endpoint that reads an `:id` from the path. Add this handler inside
`service api`:

```karn
  on http GET "/notes/:id" (id: String) -> Effect[HttpResult[NoteView]] {
    NotFound
  }
```

The `:id` segment in the route becomes the `id` parameter. (We have no storage
yet — that arrives in [Tutorial 5](05-stateful-agent.md) — so for now every
lookup honestly returns `NotFound`, the `404` variant.)

`Ok`, `Created`, `NotFound` are three of the `HttpResult` variants. The full set
covers the common HTTP outcomes — `Ok` (200), `Created` (201), `NoContent`
(204), `BadRequest` (400), `Unauthorized` (401), `Forbidden` (403), `NotFound`
(404), `Conflict` (409), `UnprocessableEntity` (422), and `ServerError` (500).
See the [HTTP reference](../reference/http.md) for the complete list and the
status code each maps to.

## Run it

The emitted `out/workers/notes/` directory is a standard Cloudflare Worker. With
the [Wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI you can
run it locally from that directory:

```sh
cd out/workers/notes
npx wrangler dev
```

Then `GET /ping` answers `pong`, `POST /notes` with `{"title":"Buy milk"}`
returns a `201` with the new note, and `GET /notes/anything` returns `404`.

## What you have done

You built a three-endpoint HTTP service, compiled it to a Cloudflare Worker, and
saw how `karn` generates the router and boundary validation around the handler
logic you wrote. You returned several `HttpResult` variants and accepted a typed
request body.

Those record types we glossed over deserve a proper look — that is next.

➡️ **[Tutorial 3: Model your data with types](03-modelling-data.md)**

---

*Curious why a context maps to a Worker, or how the boundary validation fits the
design? See [How a Karn program is shaped](../explanation/how-a-karn-program-is-shaped.md).*
