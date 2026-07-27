"use client";

import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_SIZE_MB } from "@cc/config/constants";
import { FileCheck2, Loader2, Trash2, Upload } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";
import { Button } from "../primitives/button";

/**
 * Drag-and-drop upload (docs/05-UI-UX-DESIGN.md §3.2 `FileUpload`): type and
 * size validation, progress, virus-scan pending state, and the link to the
 * stored object once it lands.
 *
 * A client component by nature — drag state, a hidden file input and local
 * validation are all browser-side.
 *
 * The client-side type/size check is a courtesy, not the control — the
 * storage adapter enforces the same policy server-side, and both read the
 * caps from `@cc/config` so they cannot drift apart.
 */

export type FileUploadState = "empty" | "uploading" | "scanning" | "uploaded" | "error";

export interface UploadedFileInfo {
  fileName: string;
  sizeBytes: number;
  /** Where the document can be downloaded from, once stored. */
  href?: string;
}

export interface FileUploadProps {
  label: string;
  /** Renders the red REQ chip and marks the input required. */
  required?: boolean;
  hint?: string;
  state?: FileUploadState;
  file?: UploadedFileInfo;
  error?: string;
  accept?: readonly string[];
  maxSizeMb?: number;
  disabled?: boolean;
  onSelect?: (file: File) => void;
  onRemove?: () => void;
  className?: string;
}

export function FileUpload({
  label,
  required = false,
  hint,
  state = "empty",
  file,
  error,
  accept = ALLOWED_UPLOAD_TYPES,
  maxSizeMb = MAX_UPLOAD_SIZE_MB,
  disabled = false,
  onSelect,
  onRemove,
  className,
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const inputId = React.useId();
  const busy = state === "uploading" || state === "scanning";
  const shownError = error ?? localError;

  function handleFiles(files: FileList | null) {
    const selected = files?.[0];
    if (!selected) return;

    if (!accept.includes(selected.type)) {
      setLocalError(`${selected.name} isn't a supported file type. Upload a PDF, JPG or PNG.`);
      return;
    }
    if (selected.size > maxSizeMb * 1024 * 1024) {
      setLocalError(`${selected.name} is larger than ${maxSizeMb} MB. Upload a smaller file.`);
      return;
    }

    setLocalError(null);
    onSelect?.(selected);
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="text-[11.5px] font-medium text-text-mid">
          {label}
        </label>
        {required ? (
          <span className="rounded-pill border border-danger-border bg-danger-subtle px-1.5 py-0.5 text-[9px] font-medium text-danger">
            REQ
          </span>
        ) : null}
      </div>

      {state === "uploaded" && file ? (
        <div className="flex items-center gap-3 rounded-md border border-success-border bg-success-subtle px-3 py-2.5">
          <FileCheck2 aria-hidden className="size-4 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            {file.href ? (
              <a
                href={file.href}
                className="block truncate text-[12.5px] font-medium text-primary hover:underline"
              >
                {file.fileName}
              </a>
            ) : (
              <p className="truncate text-[12.5px] font-medium text-text">{file.fileName}</p>
            )}
            <p className="text-[10.5px] text-text-dim">{formatSize(file.sizeBytes)} · Scanned</p>
          </div>
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={disabled}
              aria-label={`Remove ${file.fileName}`}
            >
              <Trash2 aria-hidden className="size-3.5" />
              Remove
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!disabled && !busy) handleFiles(event.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors duration-micro",
            dragging ? "border-primary bg-primary-subtle" : "border-border-strong bg-background",
            shownError && "border-danger",
            disabled && "opacity-50",
          )}
        >
          {busy ? (
            <>
              <Loader2 aria-hidden className="size-5 animate-spin text-primary" />
              <p role="status" className="text-[12.5px] text-text-mid">
                {state === "scanning" ? "Scanning for viruses…" : "Uploading…"}
              </p>
            </>
          ) : (
            <>
              <Upload aria-hidden className="size-5 text-text-dim" />
              <p className="text-[12.5px] text-text-mid">
                Drag a file here, or{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => inputRef.current?.click()}
                  disabled={disabled}
                >
                  browse
                </button>
              </p>
              <p className="text-[10.5px] text-text-dim">PDF, JPG or PNG · up to {maxSizeMb} MB</p>
            </>
          )}

          <input
            ref={inputRef}
            id={inputId}
            type="file"
            className="sr-only"
            accept={accept.join(",")}
            required={required}
            disabled={disabled || busy}
            aria-describedby={shownError ? `${inputId}-error` : undefined}
            onChange={(event) => handleFiles(event.target.files)}
          />
        </div>
      )}

      {shownError ? (
        <p id={`${inputId}-error`} role="alert" className="text-[10.5px] text-danger">
          {shownError}
        </p>
      ) : hint ? (
        <p className="text-[10.5px] text-text-dim">{hint}</p>
      ) : null}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
