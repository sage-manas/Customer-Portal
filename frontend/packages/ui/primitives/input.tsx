import * as React from "react";

import { cn } from "../lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid = false, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-9 w-full rounded-sm border border-border bg-surface px-3 text-[12.5px] text-text placeholder:text-text-dim transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
          invalid && "border-danger focus-visible:ring-danger",
          className,
        )}
        aria-invalid={invalid || undefined}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
