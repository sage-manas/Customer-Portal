"use client";

import {
  TICKET_CATEGORY_LIST,
  TICKET_PRIORITY_LIST,
  type TicketCategory,
  type TicketPriority,
} from "@cc/domain";
import { Button, cn, Input, Select, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Raise Ticket (docs/03 Screen 8.1, docs/05 §7.8).
 *
 * The category and priority pickers are rendered **from the domain
 * registries**, hints included — this screen carries no list of categories,
 * no SLA hours and no routing knowledge (CLAUDE.md rule 3). Adding a category
 * is a row in `@cc/domain`, not an edit here.
 *
 * Client-side validation is a courtesy. `ticketCreateSchema` runs in the route
 * handler and again in the service; the maxlength on the subject exists so a
 * customer sees the 40-character limit while typing rather than after
 * submitting.
 */

export interface TicketFormProps {
  /** Pre-filled when arriving from a POD or an invoice dispute (docs/05 §7.8). */
  defaultCategory?: TicketCategory;
  defaultRelatedDocType?: "order" | "delivery" | "invoice";
  defaultRelatedDocNumber?: string;
}

interface FieldIssue {
  field: string;
  message: string;
}

const SUBJECT_MAX = 40;

export function TicketForm({
  defaultCategory = "general",
  defaultRelatedDocType,
  defaultRelatedDocNumber,
}: TicketFormProps) {
  const router = useRouter();

  const [category, setCategory] = useState<TicketCategory>(defaultCategory);
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [docType, setDocType] = useState(defaultRelatedDocType ?? "");
  const [docNumber, setDocNumber] = useState(defaultRelatedDocNumber ?? "");
  const [attachmentKeys, setAttachmentKeys] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;

  const categoryDef = TICKET_CATEGORY_LIST.find((def) => def.key === category);
  const priorityDef = TICKET_PRIORITY_LIST.find((def) => def.key === priority);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/support/attachments", { method: "POST", body: form });
      const body = (await response.json()) as { storageKey?: string; error?: string };
      if (!response.ok || !body.storageKey) {
        setError(body.error ?? "We couldn't upload that file.");
        return;
      }
      setAttachmentKeys((keys) => [...keys, body.storageKey!]);
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setIssues([]);

    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          priority,
          subject,
          description,
          // An empty picker means "no reference", not an empty document
          // number the service then tries to look up in SAP.
          relatedDocType: docType === "" ? undefined : docType,
          relatedDocNumber: docType === "" ? undefined : docNumber,
          attachmentKeys,
        }),
      });

      const body = (await response.json()) as {
        id?: string;
        error?: string;
        issues?: FieldIssue[];
      };

      if (!response.ok || !body.id) {
        setError(body.error ?? "We couldn't raise this ticket.");
        setIssues(body.issues ?? []);
        return;
      }

      router.push(`/support/${body.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-2.5 text-[12.5px] text-danger"
        >
          {error}
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[12.5px] font-semibold text-text">Category</legend>
        <div className="flex flex-wrap gap-2">
          {TICKET_CATEGORY_LIST.map((def) => (
            <button
              key={def.key}
              type="button"
              aria-pressed={def.key === category}
              onClick={() => setCategory(def.key)}
              className={cn(
                "rounded-pill border px-3 py-1 text-[12px] font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                def.key === category
                  ? "border-accent-support bg-accent-support/10 text-accent-support"
                  : "border-border bg-surface text-text-mid hover:bg-primary-subtle",
              )}
            >
              {def.label}
            </button>
          ))}
        </div>
        {categoryDef ? <p className="text-[11px] text-text-dim">{categoryDef.hint}</p> : null}
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-text">Priority</span>
        <Select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TicketPriority)}
          options={TICKET_PRIORITY_LIST.map((def) => ({ value: def.key, label: def.label }))}
        />
        {/* The SLA hint comes from the registry, so the promise on screen and
            the clock the ticket is measured against are the same number. */}
        {priorityDef ? <span className="text-[11px] text-text-dim">{priorityDef.hint}</span> : null}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-text">Subject</span>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={SUBJECT_MAX}
          required
          aria-describedby="subject-hint"
        />
        <span id="subject-hint" className="text-[11px] text-text-dim tabular-nums">
          {subject.length}/{SUBJECT_MAX}
        </span>
        {issueFor("subject") ? (
          <span className="text-[11px] text-danger">{issueFor("subject")}</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-text">What happened?</span>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          maxLength={2000}
          required
        />
        {issueFor("description") ? (
          <span className="text-[11px] text-danger">{issueFor("description")}</span>
        ) : null}
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[12.5px] font-semibold text-text">
          Related document <span className="font-normal text-text-dim">(optional)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          <Select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            aria-label="Document type"
            className="max-w-[10rem]"
            options={[
              { value: "", label: "None" },
              { value: "order", label: "Order" },
              { value: "delivery", label: "Delivery" },
              { value: "invoice", label: "Invoice" },
            ]}
          />
          {docType !== "" ? (
            <Input
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              placeholder="Document number"
              aria-label="Document number"
              className="max-w-[14rem] font-mono"
            />
          ) : null}
        </div>
        {issueFor("relatedDocNumber") ? (
          <span className="text-[11px] text-danger">{issueFor("relatedDocNumber")}</span>
        ) : null}
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-text">
          Attachments <span className="font-normal text-text-dim">(optional)</span>
        </span>
        <input
          type="file"
          disabled={uploading || attachmentKeys.length >= 5}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
          className="text-[12px] text-text-mid file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1 file:text-[12px] file:font-medium"
        />
        {attachmentKeys.length > 0 ? (
          <span className="text-[11px] text-text-dim">
            {attachmentKeys.length} file{attachmentKeys.length === 1 ? "" : "s"} attached
          </span>
        ) : null}
      </label>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting || uploading}>
          {submitting ? "Raising…" : "Raise ticket"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/support")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
