/**
 * SAP dictionary types, per docs/03-FUNCTIONAL-SPEC.md legend.
 */
export type SapType =
  | "CHAR"
  | "NUMC"
  | "DATS"
  | "CURR"
  | "QUAN"
  | "UNIT"
  | "TEXT"
  | "FILE"
  | "STATUS"
  | "SELECT"
  | "BOOLEAN";

/**
 * Req codes, per docs/03-FUNCTIONAL-SPEC.md legend:
 * M = mandatory, O = optional, C = conditional, R = read-only/display.
 */
export type SapFieldReq = "M" | "O" | "C" | "R";

/**
 * One row of the SAP field mapping registry. This is the single source of
 * truth for a portal field's identity, SAP origin, and validation shape —
 * screens, Zod schemas and the SapField UI component are all derived from
 * this, never hand-duplicated (docs/06 engineering standards).
 */
export interface SapFieldDef {
  /** camelCase field name used in the portal domain layer. */
  portalField: string;
  /** Human-readable label for forms/tables. */
  label: string;
  sapTable: string;
  sapField: string;
  sapType: SapType;
  /** Max length / precision, where applicable (omitted for BOOLEAN, FILE). */
  length?: number;
  required: SapFieldReq;
  notes?: string;
}

export type SapMappingRegistry = readonly SapFieldDef[];
