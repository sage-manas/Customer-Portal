# @cc/adapter-storage

Portal object storage behind one interface, mock-first (Phase 2).

Uploaded documents (PAN copy, GST certificate, incorporation certificate) are held here until they're attached to the SAP object via GOS (docs/03 Screen 1.4). Service code holds a `storageKey` and the `ObjectStorage` contract — it never knows whether the bytes are in a Map, on disk, or in a bucket.

## Drivers

| Driver   | Use                                                                                        |
| -------- | ------------------------------------------------------------------------------------------ |
| `memory` | Default mock. In-process Map — tests, Storybook, CI.                                       |
| `local`  | Dev server. Same mock, filesystem-backed, so uploads survive a hot reload. Needs `root`.   |
| `s3`     | Phase 7 skeleton. Throws `not_implemented` rather than silently writing to ephemeral disk. |

Both mock drivers are covered by one suite (`src/drivers/storage.test.ts`) that doubles as the contract test for the real driver.

## Public API

| Export                                                 | Purpose                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `ObjectStorage`, `StoredObject`, `PutObjectInput`      | The contract and its shapes.                                  |
| `createObjectStorage(config)` / `resetObjectStorage()` | Driver resolution (platform-wide, not per tenant).            |
| `DEFAULT_UPLOAD_POLICY`                                | Size/type caps, derived from `@cc/config` constants.          |
| `StorageError`, `isStorageError`                       | `not_found` · `rejected` · `unavailable` · `not_implemented`. |

## Tenant isolation

Storage is platform-wide; isolation comes from the **key prefix** the caller builds (`<tenantId>/onboarding/<applicationId>/<kind>`) plus the tenant-scoped DB row that references it. A key is never handed to a client — documents are streamed through a route handler that re-checks the session. The `local` driver additionally refuses any key that resolves outside its root.

## Testing

```
pnpm --filter @cc/adapter-storage test
```
