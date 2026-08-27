import * as React from "react";

import { cn } from "../lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  options: readonly SelectOption[];
  /** Shown as a disabled first option when the field has no value yet. */
  placeholder?: string;
}

/**
 * Native `<select>`, themed by tokens. Native rather than a Radix listbox on
 * purpose: these render inside long data-entry forms where the platform
 * control gives correct mobile behaviour, correct keyboard type-ahead and
 * correct screen-reader semantics for free (docs/05 §9). A searchable
 * Combobox arrives separately for the material picker, which genuinely
 * needs one.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid = false, options, placeholder, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "flex h-9 w-full rounded-sm border border-border bg-surface px-2.5 text-[12.5px] text-text transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
          invalid && "border-danger focus-visible:ring-danger",
          className,
        )}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
);
Select.displayName = "Select";
