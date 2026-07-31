import http from "k6/http";
import { check, sleep } from "k6";

import { baseUrl, login } from "./lib/auth.js";

/**
 * Payment-read load scenario (docs/07 B6). Also read-only, and for a
 * sharper reason than orders: `payment:pay` (initiating a real capture) is
 * the one write in this codebase that talks to a real gateway and is
 * genuinely money-moving (ADR-019/ADR-021). Load-testing that path means
 * hammering a sandbox gateway with synthetic charges, which needs its own
 * gateway-side rate-limit awareness and cleanup story — deliberately out of
 * scope for this scaffold. `GET /api/payments/open-items` and the
 * statement (`GET /api/payments`) are the reads a customer's dashboard load
 * actually generates, and both compose a live SAP/BSID read every time.
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

  const openItems = http.get(`${baseUrl()}/api/payments/open-items`);
  check(openItems, { "open items 200": (r) => r.status === 200 });

  const statement = http.get(`${baseUrl()}/api/payments`);
  check(statement, { "payment statement 200": (r) => r.status === 200 });

  sleep(1);
}
