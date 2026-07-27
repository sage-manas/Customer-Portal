import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { ObjectStorage } from "../contract";

import { LocalObjectStorage } from "./local";
import { MemoryObjectStorage } from "./memory";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

const tempRoots: string[] = [];

async function localStorage(): Promise<ObjectStorage> {
  const root = await mkdtemp(path.join(tmpdir(), "cc-storage-"));
  tempRoots.push(root);
  return new LocalObjectStorage({ root });
}

afterAll(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * One suite, both mock drivers: they are interchangeable behind
 * `ObjectStorage`, and the day a real driver arrives it runs this same
 * suite as its contract test.
 */
const drivers: [string, () => Promise<ObjectStorage>][] = [
  ["memory", async () => new MemoryObjectStorage()],
  ["local", localStorage],
];

describe.each(drivers)("%s driver", (_name, make) => {
  const key = "tenant-1/onboarding/app-1/pan.pdf";
  const put = {
    key,
    body: PDF,
    contentType: "application/pdf",
    fileName: "pan-card.pdf",
  };

  it("round-trips an object with its metadata", async () => {
    const storage = await make();
    const metadata = await storage.put(put);

    expect(metadata).toMatchObject({
      key,
      contentType: "application/pdf",
      fileName: "pan-card.pdf",
      sizeBytes: PDF.byteLength,
      scan: "clean",
    });

    const fetched = await storage.get(key);
    expect(fetched.body).toEqual(PDF);
    expect(fetched.metadata.fileName).toBe("pan-card.pdf");
    expect(await storage.head(key)).toMatchObject({ key });
  });

  it("reports a missing key as not_found, never as an empty file", async () => {
    const storage = await make();
    await expect(storage.get("tenant-1/nope.pdf")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("deletes idempotently", async () => {
    const storage = await make();
    await storage.put(put);
    await storage.delete(key);
    await storage.delete(key);
    await expect(storage.head(key)).rejects.toMatchObject({ kind: "not_found" });
  });

  it("rejects a disallowed content type with copy the applicant can act on", async () => {
    const storage = await make();
    const error = await storage
      .put({ ...put, contentType: "application/zip", fileName: "docs.zip" })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ kind: "rejected" });
    expect((error as Error).message).toContain("PDF");
  });

  it("rejects a file over the size cap", async () => {
    const storage = await make();
    await expect(
      storage.put({ ...put, body: new Uint8Array(6 * 1024 * 1024) }),
    ).rejects.toMatchObject({ kind: "rejected" });
  });

  it("rejects an empty file", async () => {
    const storage = await make();
    await expect(storage.put({ ...put, body: new Uint8Array(0) })).rejects.toMatchObject({
      kind: "rejected",
    });
  });
});

describe("local driver key handling", () => {
  it("refuses a key that escapes the root", async () => {
    const storage = await localStorage();
    await expect(
      storage.put({
        key: "../../etc/passwd",
        body: PDF,
        contentType: "application/pdf",
        fileName: "x.pdf",
      }),
    ).rejects.toMatchObject({ kind: "rejected" });
  });
});
