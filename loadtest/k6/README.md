# k6 load test scripts (docs/07 B6)

Not run as part of `turbo run test` and not wired into CI — `k6` is a
separate binary this environment doesn't have installed, and a load test
against a shared environment is an operational action, not a unit test. See
`docs/09-GA-HARDENING-CHECKLIST.md` for how this fits into the rest of B6.

## What's here

- `catalogue.js` — browse + product detail + per-card availability, the
  per-card lazy-load shape ADR-013 describes.
- `orders.js` — the order list, which composes a live SAP read on every
  request (ADR-016) rather than reading a cache.
- `payments.js` — open items + statement, the two reads a payments-screen
  load actually generates. Deliberately does **not** exercise `POST
/api/payments` or `POST /api/orders` — hammering a real payment gateway or
  creating real sales orders needs disposable seed data and a cleanup pass
  this scaffold doesn't have. Extend it only against a tenant built for that
  purpose.
- `lib/auth.js` — shared login helper; k6 keeps cookies per-VU automatically.

## Running

```
# install k6: https://k6.io/docs/get-started/installation/
docker compose -f docker-compose.dev.yml up -d
pnpm --filter web dev &   # or a real staging URL via -e BASE_URL=

k6 run loadtest/k6/catalogue.js \
  -e BASE_URL=http://acme.localhost:3000 \
  -e EMAIL=buyer@acme.example \
  -e PASSWORD=portal-dev-password
```

Swap `MATERIAL` (catalogue.js) for a material code that exists in the target
tenant. Thresholds (`p(95)` latency, error rate) are starting points, not
calibrated against a specific box — tighten them once a baseline run exists.

**Never point these at a shared/production tenant without coordinating with
whoever owns it** — even the read-only scenarios above generate real load
against real SAP mock/adapter calls and, once Track C lands, a real SAP
system.
