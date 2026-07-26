import { z, type ZodRawShape, type ZodTypeAny } from "zod";

import type { SapFieldDef, SapMappingRegistry } from "./types";

const DATS_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NUMC_PATTERN = /^\d+$/;

/**
 * Derives a single Zod type from a field's SAP type/length. Validation
 * rules come from the SAP data type — never hand-duplicated per screen
 * (docs/05-UI-UX-DESIGN.md P3).
 */
function zodTypeFor(field: SapFieldDef): ZodTypeAny {
  switch (field.sapType) {
    case "CHAR":
    case "TEXT": {
      let schema = z.string();
      if (field.length)
        schema = schema.max(
          field.length,
          `${field.label} must be at most ${field.length} characters`,
        );
      return schema;
    }
    case "NUMC": {
      let schema = z.string().regex(NUMC_PATTERN, `${field.label} must be numeric`);
      if (field.length) schema = schema.max(field.length);
      return schema;
    }
    case "DATS":
      return z.string().regex(DATS_PATTERN, `${field.label} must be an ISO date (YYYY-MM-DD)`);
    case "CURR":
    case "QUAN":
      return z.coerce.number().nonnegative(`${field.label} must not be negative`);
    case "UNIT":
      return z.string().max(field.length ?? 3);
    case "BOOLEAN":
      return z.boolean();
    case "FILE":
      // Domain layer stays IO-free: a FILE field is a reference (object
      // storage key/URL), not a raw File/Blob — upload handling lives in
      // packages/services.
      return z.string().min(1, `${field.label} is required`);
    case "STATUS":
    case "SELECT":
      return z.string();
    default: {
      const _exhaustive: never = field.sapType;
      throw new Error(`Unhandled SAP type: ${_exhaustive}`);
    }
  }
}

export type ZodSchemaMode = "write" | "read";

/**
 * Builds a Zod object schema from a SAP mapping registry.
 *
 * - "write" (default): fields the user submits. Read-only (`R`) fields are
 *   dropped, mandatory (`M`) fields are required, everything else optional.
 * - "read": the shape as returned from SAP — every field optional, since
 *   any of them may be blank/unset depending on document state.
 */
export function buildZodSchema<T extends SapMappingRegistry>(
  registry: T,
  mode: ZodSchemaMode = "write",
) {
  const shape: ZodRawShape = {};

  for (const field of registry) {
    if (mode === "write" && field.required === "R") continue;

    let fieldSchema = zodTypeFor(field);
    const isRequired = mode === "write" && field.required === "M";
    if (!isRequired) fieldSchema = fieldSchema.optional();

    shape[field.portalField] = fieldSchema;
  }

  return z.object(shape);
}

/** Looks up a single field definition by its portal field name. */
export function findField<T extends SapMappingRegistry>(
  registry: T,
  portalField: string,
): SapFieldDef | undefined {
  return registry.find((f) => f.portalField === portalField);
}
