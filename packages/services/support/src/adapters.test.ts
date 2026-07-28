import { describe, expect, it } from "vitest";

import { attachmentStorageKey } from "./adapters";
import { invalidFrom, isSupportError, SupportError } from "./errors";

describe("attachmentStorageKey", () => {
  it("prefixes every key with the tenant", () => {
    const key = attachmentStorageKey("tenant_1", "TKT-000001", "photo.JPG", "abc");
    expect(key.startsWith("tenant_1/support/")).toBe(true);
  });

  it("keeps two files of the same name apart", () => {
    // A ticket carries many attachments and two of them are quite likely to
    // be called photo.jpg — unlike a POD, of which there is exactly one.
    const a = attachmentStorageKey("tenant_1", "TKT-1", "photo.jpg", "token-a");
    const b = attachmentStorageKey("tenant_1", "TKT-1", "photo.jpg", "token-b");
    expect(a).not.toBe(b);
  });

  it("normalises the extension and survives a file that has none", () => {
    expect(attachmentStorageKey("t", "TKT-1", "scan.PDF", "x")).toBe("t/support/TKT-1/x.pdf");
    expect(attachmentStorageKey("t", "TKT-1", "README", "x")).toBe("t/support/TKT-1/x");
  });
});

describe("SupportError", () => {
  it("answers 404 for a ticket that isn't this customer's", () => {
    // Never 403: the portal must not confirm another customer's ticket
    // exists (CLAUDE.md rule 5).
    const error = new SupportError("not_found");
    expect(error.status).toBe(404);
    expect(isSupportError(error)).toBe(true);
  });

  it("carries field issues through from a Zod failure", () => {
    const error = invalidFrom({
      issues: [{ path: ["lines", 0, "receivedQty"], message: "Too low." }],
    });
    expect(error.status).toBe(422);
    expect(error.issues).toEqual([{ field: "lines.0.receivedQty", message: "Too low." }]);
  });
});
