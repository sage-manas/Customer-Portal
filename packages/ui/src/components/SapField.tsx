import type { SapFieldDef, SapType } from "@cc/domain/sap-mapping";
import * as React from "react";

import { cn } from "../lib/cn";
import { Input, type InputProps } from "../primitives/input";
import { Select, type SelectOption } from "../primitives/select";

const HTML_INPUT_TYPE: Partial<Record<SapType, InputProps["type"]>> = {
  DATS: "date",
  CURR: "number",
  QUAN: "number",
  NUMC: "text",
};

export interface SapFieldProps extends Omit<InputProps, "type" | "id" | "onChange" | "onBlur"> {
  field: SapFieldDef;
  error?: string;
  /**
   * Turns the field into a select. The list belongs to the domain layer
   * (state codes, GST registration types, account groups) — this component
   * renders whatever it's given and never carries a list of its own.
   */
  options?: readonly SelectOption[];
  placeholder?: string;
  /** Widened to both elements so one handler serves the input and the select. */
  onChange?: React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLSelectElement>;
}

/**
 * Wraps any input with its SAP field contract: label + required asterisk and
 * the input itself (type/length derived from the registry). This is the
 * concrete implementation of docs/05 P3 — "every field carries its contract."
 */
export function SapField({
  field,
  error,
  options,
  placeholder,
  className,
  ...inputProps
}: SapFieldProps) {
  const inputId = `sap-field-${field.sapTable}-${field.sapField}`;
  const describedBy = error ? `${inputId}-error` : undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="text-[11.5px] font-medium text-text-mid">
          {field.label}
          {field.required === "M" && <span className="ml-0.5 text-danger">*</span>}
        </label>
      </div>

      {options ? (
        <Select
          id={inputId}
          options={options}
          placeholder={placeholder ?? `Select ${field.label.toLowerCase()}`}
          disabled={field.required === "R" || inputProps.disabled}
          invalid={Boolean(error)}
          aria-describedby={describedBy}
          value={inputProps.value as string | undefined}
          defaultValue={inputProps.defaultValue as string | undefined}
          onChange={inputProps.onChange}
          onBlur={inputProps.onBlur}
          name={inputProps.name}
        />
      ) : (
        <Input
          id={inputId}
          type={HTML_INPUT_TYPE[field.sapType] ?? "text"}
          maxLength={
            field.sapType === "CHAR" || field.sapType === "NUMC" ? field.length : undefined
          }
          readOnly={field.required === "R"}
          invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...inputProps}
        />
      )}

      {error && (
        <p id={`${inputId}-error`} className="text-[10.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
