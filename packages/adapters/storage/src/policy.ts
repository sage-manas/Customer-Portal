import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_SIZE_MB } from "@cc/config/constants";

import type { PutObjectInput } from "./contract";
import { StorageError } from "./errors";

/**
 * Upload policy (docs/05 §3.2 `FileUpload`: "type/size validation (PDF/JPG
 * ≤5MB default)"). Defaults come from the shared constants, so the client
 * hint and the server check can never drift apart — the client uses them to
 * set `accept`, the driver uses them to reject.
 */
export interface UploadPolicy {
  maxSizeBytes: number;
  allowedContentTypes: readonly string[];
}

export const DEFAULT_UPLOAD_POLICY: UploadPolicy = {
  maxSizeBytes: MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  allowedContentTypes: ALLOWED_UPLOAD_TYPES,
};

export function assertAllowed(input: PutObjectInput, policy: UploadPolicy): void {
  if (!policy.allowedContentTypes.includes(input.contentType)) {
    throw new StorageError(
      `${input.fileName} isn't a supported file type. Upload a PDF, JPG or PNG.`,
      { kind: "rejected" },
    );
  }
  if (input.body.byteLength > policy.maxSizeBytes) {
    const limitMb = Math.round(policy.maxSizeBytes / (1024 * 1024));
    throw new StorageError(
      `${input.fileName} is larger than ${limitMb} MB. Upload a smaller file.`,
      {
        kind: "rejected",
      },
    );
  }
  if (input.body.byteLength === 0) {
    throw new StorageError(`${input.fileName} is empty.`, { kind: "rejected" });
  }
}
