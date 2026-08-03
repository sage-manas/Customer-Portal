import { randomUUID } from "node:crypto";

import { isStorageError } from "@cc/adapter-storage";

import { attachmentStorageKey, getSupportStorage } from "./adapters";
import { SupportError } from "./errors";

/**
 * Ticket attachments (docs/03 Screen 8.1 "Attachment (GOS)", docs/05 §7.8).
 *
 * The same two-step shape as the signed-POD scan (ADR-026): the bytes are
 * uploaded first and the form then carries a storage key into the write. The
 * ordering matters for the same reason — the upload is the slow, failure-prone
 * part, and a customer whose file times out after the ticket was raised has a
 * ticket describing an attachment that isn't there.
 *
 * A ticket may not exist yet when its first files are uploaded, so the key is
 * namespaced by a caller-supplied reference (a draft id from the form, or the
 * ticket id for a later comment) rather than by a ticket that has no id.
 */

export interface UploadAttachmentInput {
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

export interface UploadedAttachment {
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export async function uploadTicketAttachment(
  context: { tenantId: string },
  ticketRef: string,
  input: UploadAttachmentInput,
): Promise<UploadedAttachment> {
  try {
    const stored = await getSupportStorage().put({
      key: attachmentStorageKey(context.tenantId, ticketRef, input.fileName, randomUUID()),
      body: input.body,
      contentType: input.contentType,
      fileName: input.fileName,
    });

    return {
      storageKey: stored.key,
      fileName: stored.fileName,
      contentType: stored.contentType,
      sizeBytes: stored.sizeBytes,
    };
  } catch (error) {
    // The storage adapter enforces the type/size policy server-side; the
    // browser check is a courtesy, not the control.
    if (isStorageError(error) && error.kind === "rejected") {
      throw new SupportError("invalid", {
        issues: [{ field: "attachment", message: error.message }],
        cause: error,
      });
    }
    throw new SupportError("upstream_unavailable", { cause: error });
  }
}

/**
 * Turns the storage keys a form submitted back into rows worth storing.
 *
 * The write path receives keys, not metadata — the client must not be able to
 * assert a file's name, type or size, since it would be asserting them about
 * bytes it no longer controls. So the name and size are read back from the
 * store, which is the only participant that actually knows.
 *
 * A key that isn't in the store is dropped rather than fabricated: it means
 * the client sent a key for something it never uploaded, and inventing a row
 * for it would put an attachment on the ticket that can never be opened.
 */
export async function describeAttachments(keys: readonly string[]): Promise<UploadedAttachment[]> {
  if (keys.length === 0) return [];

  const storage = getSupportStorage();
  const described = await Promise.all(
    keys.map(async (key) => {
      const metadata = await storage.head(key).catch(() => null);
      if (!metadata) return null;
      return {
        storageKey: metadata.key,
        fileName: metadata.fileName,
        contentType: metadata.contentType,
        sizeBytes: metadata.sizeBytes,
      };
    }),
  );

  return described.filter((item): item is UploadedAttachment => item !== null);
}
