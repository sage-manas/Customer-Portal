import http from "k6/http";
import { check } from "k6";

/**
 * Shared login helper for the catalogue/order/payment scenarios (docs/07
 * B6). k6's `http` client keeps cookies per-VU automatically (a `Jar` is
 * created implicitly per default client), so a script just needs to POST
 * once before its own requests — no manual cookie plumbing.
 *
 * Defaults match CLAUDE.md's documented dev seed: `acme.localhost:3000`,
 * `buyer@acme.example` / `portal-dev-password`. Override via k6 env vars
 * (`k6 run -e BASE_URL=... -e EMAIL=... -e PASSWORD=...`) against a seeded
 * staging tenant before running this for real.
 */
export function baseUrl() {
  return __ENV.BASE_URL || "http://acme.localhost:3000";
}

export function login() {
  const res = http.post(
    `${baseUrl()}/api/auth/login`,
    JSON.stringify({
      email: __ENV.EMAIL || "buyer@acme.example",
      password: __ENV.PASSWORD || "portal-dev-password",
    }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(res, { "login succeeded": (r) => r.status === 200 });
  return res;
}
