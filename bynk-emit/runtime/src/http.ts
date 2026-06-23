import type { JsonValue } from "./boundary.ts";

// v0.9: HttpResult — the built-in HTTP-result sum.

export type HttpResult<T> =
  | { readonly tag: "Ok"; readonly value: T }
  | { readonly tag: "Created"; readonly value: T }
  | { readonly tag: "NoContent" }
  | { readonly tag: "BadRequest"; readonly message: string }
  | { readonly tag: "Unauthorized" }
  | { readonly tag: "Forbidden" }
  | { readonly tag: "NotFound" }
  | { readonly tag: "Conflict"; readonly message: string }
  | { readonly tag: "UnprocessableEntity"; readonly message: string }
  | { readonly tag: "ServerError"; readonly message: string };

export const HttpResult = {
  Ok: <T>(value: T): HttpResult<T> => ({ tag: "Ok", value }),
  Created: <T>(value: T): HttpResult<T> => ({ tag: "Created", value }),
  NoContent: { tag: "NoContent" } as HttpResult<never>,
  BadRequest: (message: string): HttpResult<never> => ({ tag: "BadRequest", message }),
  Unauthorized: { tag: "Unauthorized" } as HttpResult<never>,
  Forbidden: { tag: "Forbidden" } as HttpResult<never>,
  NotFound: { tag: "NotFound" } as HttpResult<never>,
  Conflict: (message: string): HttpResult<never> => ({ tag: "Conflict", message }),
  UnprocessableEntity: (message: string): HttpResult<never> => ({
    tag: "UnprocessableEntity",
    message,
  }),
  ServerError: (message: string): HttpResult<never> => ({ tag: "ServerError", message }),
};

// Match a path pattern (e.g., "/orders/:id") against a request path.
// Returns the captured parameter map, or null on no match.
export function matchPath(
  pattern: string,
  path: string,
): { params: Record<string, string> } | null {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = path.split("/").filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const p = patternSegments[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(pathSegments[i]);
    } else if (p !== pathSegments[i]) {
      return null;
    }
  }
  return { params };
}

// Serialise an HttpResult<T> to a Response. The variant determines the
// HTTP status code; the body (if any) is JSON-encoded.
export function httpResultToResponse<T>(
  result: HttpResult<T>,
  serialiseValue: (v: T) => JsonValue,
): Response {
  switch (result.tag) {
    case "Ok":
      return new Response(JSON.stringify(serialiseValue(result.value)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    case "Created":
      return new Response(JSON.stringify(serialiseValue(result.value)), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    case "NoContent":
      return new Response(null, { status: 204 });
    case "BadRequest":
      return new Response(JSON.stringify({ error: result.message }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    case "Unauthorized":
      return new Response(null, { status: 401 });
    case "Forbidden":
      return new Response(null, { status: 403 });
    case "NotFound":
      return new Response(null, { status: 404 });
    case "Conflict":
      return new Response(JSON.stringify({ error: result.message }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    case "UnprocessableEntity":
      return new Response(JSON.stringify({ error: result.message }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    case "ServerError":
      return new Response(JSON.stringify({ error: result.message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
  }
}
