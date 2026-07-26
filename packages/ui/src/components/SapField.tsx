import type { SapFieldDef, SapType } from "@cc/domain/sap-mapping";
import * as React from "react";

import { cn } from "../lib/cn";
import { Badge } from "../primitives/badge";
import { Input, type InputProps } from "../primitives/input";

const TYPE_CHIP_CLASS: Record<SapType, string> = {
  CHAR: "border-info-border bg-info-subtle text-info",
  TEXT: "border-info-border bg-info-subtle text-info",
  NUMC: "border-success-border bg-success-subtle text-success",
  CURR: "border-success-border bg-success-subtle text-success",
  QUAN: "border-success-border bg-success-subtle text-success",
  UNIT: "border-success-border bg-success-subtle text-success",
  DATS: "border-warning-border bg-warning-subtle text-warning",
  FILE: "border-danger-border bg-danger-subtle text-danger",
  BOOLEAN: "border-border bg-background text-text-mid",
  STATUS: "border-border bg-background text-text-mid",
  SELECT: "border-border bg-background text-text-mid",
};

const HTML_INPUT_TYPE: Partial<Record<SapType, InputProps["type"]>> = {
  DATS: "date",
  CURR: "number",
  QUAN: "number",
  NUMC: "text",
};

export interface SapFieldProps extends Omit<InputProps, "type" | "id"> {
  field: SapFieldDef;
  error?: string;
  /**
   * Shows the SAP table/field/type/length footer strip. Off by default for
   * end customers; a tenant admin/dev toggle flips this on (docs/05 §3.2).
   */
  specMode?: boolean;
}

/**
 * Wraps any input with its SAP field contract: label + REQ chip, the input
 * itself (type/length derived from the registry), and an optional spec-mode
 * footer showing table/field/type/length. This is the concrete
 * implementation of docs/05 P3 — "every field carries its contract."
 */
export function SapField({
  field,
  error,
  specMode = false,
  className,
  ...inputProps
}: SapFieldProps) {
  const inputId = `sap-field-${field.sapTable}-${field.sapField}`;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="text-[11.5px] font-medium text-text-mid">
          {field.label}
        </label>
        {field.required === "M" && (
          <Badge variant="danger" className="text-[9px]">
            REQ
          </Badge>
        )}
      </div>

      <Input
        id={inputId}
        type={HTML_INPUT_TYPE[field.sapType] ?? "text"}
        maxLength={field.sapType === "CHAR" || field.sapType === "NUMC" ? field.length : undefined}
        readOnly={field.required === "R"}
        invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...inputProps}
      />

      {error && (
        <p id={`${inputId}-error`} className="text-[10.5px] text-danger">
          {error}
        </p>
      )}
      {!error && field.notes && <p className="text-[10.5px] text-text-dim">{field.notes}</p>}

      {specMode && (
        <div className="flex items-center justify-between border-t border-border pt-1 text-[10px]">
          <div className="flex items-center gap-1">
            <span
              className={cn(
                "rounded-sm border px-1 py-0.5 font-mono",
                TYPE_CHIP_CLASS[field.sapType],
              )}
            >
              {field.sapType}
            </span>
            {field.length !== undefined && (
              <span className="rounded-sm border border-border px-1 py-0.5 font-mono text-text-dim">
                LEN {field.length}
              </span>
            )}
          </div>
          <span className="font-mono text-text-dim">
            {field.sapTable}-{field.sapField}
          </span>
        </div>
      )}
    </div>
  );
}
