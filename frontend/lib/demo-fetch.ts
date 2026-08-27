"use client";

import { demoRequest } from "./demo-api";

/**
 * A drop-in stand-in for `fetch` against the portal's own `/api/*` routes.
 *
 * Every migrated client component kept its original request — same URL, same
 * method, same body, same response handling, same error and loading states.
 * The only change per file is `fetch(` -> `demoFetch(` plus this import,
 * which is what makes the change back to the real API a one-line revert per
 * component when the backend lands.
 *
 * It returns a real `Response`, so `response.ok`, `response.status` and
 * `await response.json()` in the call sites all behave exactly as before.
 *
 * TODO(BACKEND):
 * Replace every `demoFetch(` with `fetch(` and delete this file, once
 * client/apps/web/app/api/** has been migrated.
 */
export async function demoFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
  const method = init.method ?? "GET";

  // Route handlers read the draft token off `x-draft-token`, not the body —
  // it has to survive the trip through here or the applicant plane can never
  // prove which draft it's editing.
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  let body: Record<string, unknown> | null = null;
  let formFields: Record<string, string> | null = null;

  if (init.body instanceof FormData) {
    // Files cannot be stored anywhere in demo mode, so only the metadata
    // travels — enough for the UI to list what was "uploaded".
    formFields = {};
    for (const [key, value] of init.body.entries()) {
      if (value instanceof File) {
        formFields.fileName = value.name;
        formFields.contentType = value.type || "application/octet-stream";
        formFields.sizeBytes = String(value.size);
      } else {
        formFields[key] = String(value);
      }
    }
  } else if (typeof init.body === "string") {
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      body = null;
    }
  }

  const result = await demoRequest(url, method, body, formFields, headers);

  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}
