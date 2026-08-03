import http from "k6/http";
import { check, sleep } from "k6";

import { baseUrl, login } from "./lib/auth.js";

/**
 * Order-list load scenario (docs/07 B6). Read-only by design: `GET
 * /api/orders` composes a live SAP read on every call (ADR-016 — "SAP owns
 * submitted orders, nothing about them is stored"), which is exactly what
 * makes this endpoint worth load-testing rather than the cart/draft-write
 * path — those hit Postgres, this hits (mock, and eventually real) SAP on
 * every request and has no cache in front of it.
 *
 * Deliberately does not exercise `POST /api/orders` (order creation): a load
 * test that actually places orders against a shared tenant would need its
 * own disposable seed data and a cleanup pass this scaffold doesn't have —
 * see the README before extending this into a write-path scenario.
 */
export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "2m", target: 10 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  login();

  const list = http.get(`${baseUrl()}/api/orders`);
  check(list, { "orders list 200": (r) => r.status === 200 });

  const page = http.get(`${baseUrl()}/orders`);
  check(page, { "orders page 200": (r) => r.status === 200 });

  sleep(1);
}
