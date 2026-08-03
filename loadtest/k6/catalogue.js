import http from "k6/http";
import { check, sleep } from "k6";

import { baseUrl, login } from "./lib/auth.js";

/**
 * Catalogue load scenario (docs/07 B6). Browse-then-detail, the read path
 * `@cc/service-catalogue` composes on every request per screen (ADR-013:
 * "price/stock load lazily per card, one request each") — the shape this
 * scenario is meant to stress is many small per-card reads, not one big one.
 *
 * `MATERIAL` must be a material code that exists in the target tenant's mock
 * SAP catalogue (see `packages/adapters/sap`'s seed data, or a real one once
 * this runs against a tenant on a real driver).
 */
export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "2m", target: 10 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<1500"],
    http_req_failed: ["rate<0.01"],
  },
};

const MATERIAL = __ENV.MATERIAL || "MAT-10001";

export default function () {
  login();

  const list = http.get(`${baseUrl()}/catalogue`);
  check(list, { "catalogue list 200": (r) => r.status === 200 });

  const detail = http.get(`${baseUrl()}/catalogue/${MATERIAL}`);
  check(detail, { "product detail 200": (r) => r.status === 200 });

  const availability = http.get(`${baseUrl()}/api/catalogue/materials/${MATERIAL}/availability`);
  check(availability, { "availability 200": (r) => r.status === 200 });

  sleep(1);
}
