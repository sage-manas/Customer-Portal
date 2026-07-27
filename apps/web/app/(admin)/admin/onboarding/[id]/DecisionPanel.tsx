"use client";

import { Button, Input, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * The three decisions a reviewer can take (docs/05 §7.1): Request More Info,
 * Reject (reason mandatory), Approve & Create in SAP.
 *
 * Approve is behind a confirmation that names the SAP consequence, per
 * docs/05 §6.2 — "Confirmation copy always names the SAP consequence for
 * write actions."
 */

interface Issue {
  field: string;
  message: string;
}

export function DecisionPanel({
  applicationId,
  canApprove,
  decidable,
}: {
  applicationId: string;
  canApprove: boolean;
  decidable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"approve" | "reject" | "info" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [upstream, setUpstream] = React.useState<string | null>(null);
  const [issues, setIssues] = React.useState<Record<string, string>>({});
  const [confirming, setConfirming] = React.useState(false);
  const [credentials, setCredentials] = React.useState<{
    email: string;
    temporaryPassword: string | null;
    kunnr: string;
  } | null>(null);

  const [salesOrg, setSalesOrg] = React.useState("");
  const [distributionChannel, setDistributionChannel] = React.useState("");
  const [creditApprovalStatus, setCreditApprovalStatus] = React.useState("");
  const [note, setNote] = React.useState("");
  const [reasons, setReasons] = React.useState("");

  async function post(
    action: "approve" | "reject" | "request-info",
    body: unknown,
    kind: "approve" | "reject" | "info",
  ) {
    setBusy(kind);
    setError(null);
    setUpstream(null);
    setIssues({});

    try {
      const response = await fetch(`/api/admin/onboarding/${applicationId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        issues?: Issue[];
        upstreamMessage?: string;
        kunnr?: string;
        credentials?: { email: string; temporaryPassword: string | null };
      } | null;

      if (!response.ok) {
        setError(payload?.error ?? "Something went wrong. Try again.");
        setUpstream(payload?.upstreamMessage ?? null);
        setIssues(Object.fromEntries((payload?.issues ?? []).map((i) => [i.field, i.message])));
        return;
      }

      if (kind === "approve" && payload?.credentials && payload.kunnr) {
        setCredentials({ ...payload.credentials, kunnr: payload.kunnr });
      }
      setConfirming(false);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (credentials) {
    return (
      <section className="rounded-md border border-success-border bg-success-subtle p-5">
        <h2 className="text-[15px] font-bold text-success">Customer created in SAP</h2>
        <p className="mt-1 text-[12.5px] text-text-mid">
          SAP assigned customer code{" "}
          <span className="font-mono font-semibold">{credentials.kunnr}</span>.
        </p>
        {credentials.temporaryPassword ? (
          <div className="mt-3 rounded-sm border border-border bg-surface p-3">
            <p className="text-[11.5px] font-medium text-text-mid">
              Sign-in details — shown once, pass them on securely:
            </p>
            <p className="mt-1 font-mono text-[12.5px] text-text">{credentials.email}</p>
            <p className="font-mono text-[12.5px] text-text">{credentials.temporaryPassword}</p>
            <p className="mt-1 text-[10.5px] text-text-dim">
              They&apos;ll be asked to set their own password at first sign-in.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] text-text-mid">
            {credentials.email} already had a portal login; the new account was linked to it.
          </p>
        )}
      </section>
    );
  }

  if (!decidable) {
    return (
      <section className="rounded-md border border-border bg-surface p-5">
        <p className="text-[12.5px] text-text-dim">
          This application has already been decided. Its history is above.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5 shadow-sm">
      <h2 className="text-[15px] font-bold text-text">Decision</h2>

      {error ? (
        <div
          role="alert"
          className="rounded-sm border border-danger-border bg-danger-subtle px-3 py-2"
        >
          <p className="text-[12.5px] text-danger">{error}</p>
          {upstream ? (
            <p className="mt-1 font-mono text-[11px] text-text-dim">SAP said: {upstream}</p>
          ) : null}
        </div>
      ) : null}

      {canApprove ? (
        <div className="flex flex-col gap-3 border-b border-border pb-4">
          <h3 className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
            Assign and approve
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field
              label="Sales Org (KNVV-VKORG)"
              value={salesOrg}
              onChange={setSalesOrg}
              error={issues.salesOrg}
              maxLength={4}
            />
            <Field
              label="Distribution Channel (KNVV-VTWEG)"
              value={distributionChannel}
              onChange={setDistributionChannel}
              error={issues.distributionChannel}
              maxLength={2}
            />
            <Field
              label="Credit Approval Status (KNKK-CTLPC)"
              value={creditApprovalStatus}
              onChange={setCreditApprovalStatus}
              error={issues.creditApprovalStatus}
            />
          </div>

          {confirming ? (
            <div className="rounded-sm border border-warning-border bg-warning-subtle px-3 py-2.5">
              <p className="text-[12.5px] text-warning">
                This creates the customer in SAP immediately and emails their sign-in details. It
                can&apos;t be undone from the portal.
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  loading={busy === "approve"}
                  onClick={() =>
                    void post(
                      "approve",
                      {
                        salesOrg,
                        distributionChannel,
                        creditApprovalStatus: creditApprovalStatus || undefined,
                      },
                      "approve",
                    )
                  }
                >
                  Yes, create in SAP
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="self-start"
              onClick={() => setConfirming(true)}
              disabled={busy !== null}
            >
              Approve &amp; create in SAP
            </Button>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <label
          htmlFor="more-info"
          className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid"
        >
          Request more information
        </label>
        <Textarea
          id="more-info"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What do you need from the applicant? They'll see this on their status page."
          invalid={Boolean(issues.note)}
        />
        {issues.note ? <p className="text-[10.5px] text-danger">{issues.note}</p> : null}
        <Button
          variant="secondary"
          className="self-start"
          loading={busy === "info"}
          disabled={busy !== null || note.trim().length === 0}
          onClick={() => void post("request-info", { note }, "info")}
        >
          Send back to applicant
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="reject-reasons"
          className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid"
        >
          Reject
        </label>
        <Textarea
          id="reject-reasons"
          value={reasons}
          onChange={(event) => setReasons(event.target.value)}
          placeholder="One reason per line. These are sent to the applicant."
          invalid={Boolean(issues.reasons)}
        />
        {issues.reasons ? <p className="text-[10.5px] text-danger">{issues.reasons}</p> : null}
        <Button
          variant="destructive"
          className="self-start"
          loading={busy === "reject"}
          disabled={busy !== null || reasons.trim().length === 0}
          onClick={() =>
            void post(
              "reject",
              {
                reasons: reasons
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              },
              "reject",
            )
          }
        >
          Reject application
        </Button>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  maxLength?: number;
}) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11.5px] font-medium text-text-mid">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
      {error ? <p className="text-[10.5px] text-danger">{error}</p> : null}
    </div>
  );
}
