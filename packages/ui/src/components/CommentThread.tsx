import { Lock, Paperclip } from "lucide-react";

import { cn } from "../lib/cn";
import { formatDisplayDate, relativeTime } from "../lib/relative-time";

/**
 * The threaded conversation on a ticket (docs/05-UI-UX-DESIGN.md §7.8:
 * "threaded comments").
 *
 * Flat, not nested. A support thread is read top to bottom, and nesting
 * invites replies that nobody sees because they landed three levels down a
 * branch collapsed by default.
 *
 * **This component is not a privacy control.** An internal note is excluded
 * from a customer's read in the *query* (`ticketSelect` in
 * `@cc/service-support`), so a customer's props never contain one. The lock
 * marker here exists so an agent can see at a glance which of their own notes
 * the customer can read — not to hide anything, because a component that
 * hides data it was given is one `console.log` away from leaking it.
 */

export interface CommentAttachment {
  id: string;
  fileName: string;
  sizeBytes: number;
  /** Where the file can be fetched from; omit to render the name unlinked. */
  href?: string;
}

export interface ThreadComment {
  id: string;
  body: string;
  createdAt: Date;
  /** Rendered on the tenant's side of the thread. */
  authorIsAgent: boolean;
  /** Display name; falls back to a role word when the author is unknown. */
  authorName?: string;
  internal: boolean;
  attachments?: readonly CommentAttachment[];
}

export interface CommentThreadProps {
  comments: readonly ThreadComment[];
  /** Injectable so stories and tests don't depend on the wall clock. */
  now?: Date;
  emptyLabel?: string;
  className?: string;
}

export function CommentThread({
  comments,
  now,
  emptyLabel = "No replies yet. We'll post updates here.",
  className,
}: CommentThreadProps) {
  if (comments.length === 0) {
    return <p className={cn("text-sm text-text-dim", className)}>{emptyLabel}</p>;
  }

  return (
    <ol className={cn("flex flex-col gap-3", className)}>
      {comments.map((comment) => (
        <li
          key={comment.id}
          className={cn(
            "rounded-lg border p-3",
            comment.internal
              ? // Internal notes read as a margin note, not as part of the
                // conversation — an agent scanning the thread must never
                // mistake one for something the customer has seen.
                "border-dashed border-warning-border bg-warning-subtle"
              : comment.authorIsAgent
                ? "border-border bg-primary-subtle"
                : "border-border bg-surface",
          )}
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
            <span className="font-semibold text-text-mid">
              {comment.authorName ?? (comment.authorIsAgent ? "Support team" : "You")}
            </span>
            <time
              dateTime={comment.createdAt.toISOString()}
              title={formatDisplayDate(comment.createdAt)}
            >
              {relativeTime(comment.createdAt, now)}
            </time>
            {comment.internal ? (
              <span className="inline-flex items-center gap-1 font-semibold text-warning">
                <Lock aria-hidden className="size-3" strokeWidth={2.25} />
                Internal — not visible to the customer
              </span>
            ) : null}
          </div>

          {/* Plain text, rendered with newlines preserved. The description and
              comments are stored as text and must never be interpreted as
              markup — a support thread is exactly where someone pastes an
              error message full of angle brackets. */}
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-text">{comment.body}</p>

          {comment.attachments && comment.attachments.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {comment.attachments.map((file) => (
                <li key={file.id}>
                  <FileChip file={file} />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function FileChip({ file }: { file: CommentAttachment }) {
  const label = (
    <>
      <Paperclip aria-hidden className="size-3" strokeWidth={2.25} />
      <span className="truncate">{file.fileName}</span>
      <span className="text-text-dim tabular-nums">{formatBytes(file.sizeBytes)}</span>
    </>
  );

  const className =
    "inline-flex max-w-[16rem] items-center gap-1.5 rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] text-text-mid";

  return file.href ? (
    <a className={cn(className, "hover:border-border-strong")} href={file.href}>
      {label}
    </a>
  ) : (
    <span className={className}>{label}</span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
