# @cc/adapter-gstn

GSTIN verification behind one interface, mock-first (Phase 2).

`GstnAdapter` is the only GSTN API the rest of the system knows about. Two drivers implement it: `mock` (built first — a seeded taxpayer registry, plus deterministic synthesis so any valid GSTIN walks the happy path) and `api` (the real GSTN taxpayer search, a Phase 7 skeleton that throws `not_implemented` rather than pretending, per `docs/DECISIONS.md` ADR-006).

Service code never imports a driver — it resolves one per tenant through `createGstnAdapter`, and `@cc/service-onboarding` is the only caller.

## Public API

| Export                                                      | Purpose                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GstnAdapter`, `GstnTaxpayer`, `GstnHealth`                 | The contract and its shapes.                                                        |
| `createGstnAdapter(config)` / `resetGstnAdapter(tenantId?)` | Per-tenant driver resolution, cached; reset after a config change or between tests. |
| `MockGstnAdapter(options)`                                  | `latencyMs`, `unavailable`, `now`, extra `registry` fixtures.                       |
| `GstnError`, `isGstnError`                                  | `invalid_format` · `not_found` · `unavailable` · `not_implemented`.                 |
| `GSTN_SEED`, `GSTN_UNREGISTERED_SPECIMEN`                   | Fixtures for tests, demos and Storybook.                                            |

## What the mock does

| GSTIN                                    | Answer                                                   |
| ---------------------------------------- | -------------------------------------------------------- |
| `27AAPFU0939F1ZV`                        | Vertex Polymers Private Limited — Active (Maharashtra)   |
| `29AAGCB7383J1Z4`                        | Bluepeak Components Private Limited — Active (Karnataka) |
| `24AAACC1206D1ZM`                        | Coastal Chemicals Limited — **Cancelled**                |
| `07AABCG1234M1ZQ`                        | Ganges Traders LLP — **Suspended**                       |
| `33AAECS5678K1ZW`                        | **not_found** (`GSTN_UNREGISTERED_SPECIMEN`)             |
| any other GSTIN with a valid check digit | synthesized Active taxpayer, deterministic in the number |
| any malformed GSTIN                      | `invalid_format`, thrown before any call is made         |

The synthesized legal name is deliberately _not_ the applicant's input: a legal-name mismatch is a warning the reviewer must be able to see, and an echoing mock would make that state untestable. Only a **state-code** mismatch blocks the applicant (docs/05 §7.1).

## Testing

```
pnpm --filter @cc/adapter-gstn test
```
