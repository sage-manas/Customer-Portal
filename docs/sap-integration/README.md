# SAP Integration — Overview

Target system: **ECC 6.x on-premise**. Approach: **RFC function modules plus a
bridge service**.

## Who reads what

| document                         | audience              | contents                                                                                                                 |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`ABAP-SPEC.md`](./ABAP-SPEC.md) | **the SAP developer** | 41 RFC function modules, DDIC structures, SE37 testing. Pure ABAP — no web concepts. **This is the only file he needs.** |
| [`openapi.yaml`](./openapi.yaml) | the bridge developer  | the HTTP contract between the bridge and the portal                                                                      |
| this file                        | the portal team       | how the two halves fit together                                                                                          |

Do not send `openapi.yaml` to the SAP developer. It is written in HTTP and JSON
terms and will only confuse the handoff.

## The shape of it

```
   Customer Portal            bridge service              SAP ECC
  ┌──────────────┐  HTTPS   ┌────────────────┐   RFC   ┌──────────┐
  │  Next.js app │ ───────► │  node-rfc      │ ──────► │ Z_CC_*   │
  │              │ ◄─────── │  translator    │ ◄────── │ function │
  └──────────────┘   JSON   └────────────────┘  BAPI   │ modules  │
                                                        └──────────┘
        openapi.yaml                    ABAP-SPEC.md
```

Traffic is outbound only at every hop. SAP never calls the bridge, the bridge
never calls the portal. Nothing needs a public URL, and the portal runs happily
on a laptop throughout the build.

## Why the work was split this way

The SAP developer knows ABAP and not the web. Asking him to build an HTTP service
would mean learning SICF handlers, JSON serialisation, status codes and REST
conventions before writing a line of the logic he is actually expert in.

So the split follows the skills. He writes RFC function modules — plain ABAP,
testable by pressing F8 in SE37, using BAPIs he already knows. Everything
portal-shaped happens in the bridge, on the side of the wall where those concepts
are native.

Three things that would otherwise be his problem move to the bridge:

| concern                                          | who handles it | what the ABAP side does                  |
| ------------------------------------------------ | -------------- | ---------------------------------------- |
| Freshness envelope (`live` / `cached` / `stale`) | bridge         | returns `EV_SYNCED_AT` only              |
| Canonical statuses (`Open`, `CreditHold`, …)     | bridge         | returns raw `GBSTK` / `CMGST` / `WBSTK`  |
| Typed JSON errors                                | bridge         | returns `BAPIRET2`, which is native ABAP |

The one portal concept that cannot move is **idempotency on writes**, because
only SAP can know whether a document was already posted. `ABAP-SPEC.md` §2.4
specifies it as a `ZCC_IDEMPOTENCY` table and a four-line pattern.

## The bridge's job

One service, roughly one thin function per operation. Its entire responsibility:

1. **Call the function module.** `node-rfc` against the RFC destination.
2. **Wrap reads** in `{ data, freshness, syncedAt }`. Build `syncedAt` from
   `EV_SYNCED_AT`. A direct call is `live`; a cached answer served during an
   outage is `stale` carrying the **original** timestamp, never the current one.
3. **Translate status codes.** `GBSTK A→Open, B→PartiallyDelivered, C→Closed`;
   `CMGST A→Open, B→CreditHold, C→Confirmed`; `WBSTK C→Delivered,
B→PartiallyDelivered, A→InTransit/Packed/Picked/Open` from the PGI flags. Note
   GBSTK maps differently on a quotation than on an order — see
   `packages/domain/src/status.ts`, which already contains every mapper.
4. **Reassemble headers and lines.** RFC returns two flat tables joined on
   `VBELN`; the portal expects nested line arrays.
5. **Map `BAPIRET2` to typed errors.** Message numbers `ZCC 001–004` map to
   `not_found` / `validation` / `authorization` / `unavailable`. Keep the original
   text in `sapMessage` for logs and admin screens; never show it to a customer.
6. **Answer 404, never 403,** when a document belongs to another account. The
   portal must not confirm that another customer's data exists.

It should hold **no business logic and no state** beyond an optional read cache.
Anything it would have to decide is a sign the decision belongs in ABAP or in the
portal.

### The one deployment wrinkle

`node-rfc` needs the SAP NetWeaver RFC SDK present as a native library. That is
the reason the bridge is its own small service rather than code inside the portal:
one place to install the SDK, one thing to containerise, and the portal stays a
plain Node application.

For local development the SDK goes on the same machine, and the bridge runs
alongside the portal on a second port.

## Getting started

**With the SAP developer**, now:

1. Send him [`ABAP-SPEC.md`](./ABAP-SPEC.md). Nothing else.
2. Ask him to build **Milestone 0 only** — `Z_CC_PING` and `Z_CC_CUST_GET`.
3. Ask his Basis team for the RFC connection details: host, system number,
   client, system ID, and a `Communications Data` service user.
4. Agree which sales organisation and distribution channel the portal transacts
   under.

**On the portal side**, in parallel: the portal already runs end-to-end against
the mock driver, so nothing is blocked while he works. Keep developing against
`mock`; switching a tenant to the real system is a configuration change in the
ops console, not a code change.

Milestone 0 is deliberately two function modules. Wrong host, blocked port,
missing authorisation, wrong client — nearly every integration failure surfaces
on the first successful round trip, and debugging it with two modules on the
table beats debugging it with forty-one.

## Reference

| question                                 | where                                                                                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The 41 operations and their exact types  | `packages/adapters/sap/src/contract.ts`                                                                                                               |
| What a correct response looks like       | `packages/adapters/sap/src/mock/driver.ts` — a working implementation of all 41                                                                       |
| Status code mappers, already written     | `packages/domain/src/status.ts`                                                                                                                       |
| Canonical field types and SAP provenance | `packages/domain/src/entities/*.ts`                                                                                                                   |
| Why a rule exists                        | `docs/DECISIONS.md` — ADR-007 freshness, ADR-016 SAP owns documents, ADR-018 tax, ADR-021 idempotency, ADR-032 separate reads, ADR-059 credit release |
