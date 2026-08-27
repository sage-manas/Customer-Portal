"use client";

import { CUSTOMER_EDIT_SECTIONS, customerEditableFields, type CanonicalCustomer } from "@cc/domain";
import { Button, FormSection, SapField } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FIELD_OPTIONS } from "@/app/(auth)/register/field-options";

// TODO(BACKEND): swap `demoFetch` back to `fetch` once /api/* is migrated.
import { demoFetch } from "@/lib/demo-fetch";

/**
 * Edit the customer master (doc 09 §3.4).
 *
 * There is no field list in this file. The inputs come from
 * `customerEditableFields()` and their grouping from `CUSTOMER_EDIT_SECTIONS`
 * — the same registry rows the onboarding wizard renders, filtered to what
 * may be changed after registration (ADR-057). The server validates with the
 * schema derived from those same rows and answers with issues keyed by
 * `portalField`, which is what puts an error under the right input.
 */

type Values = Record<string, string>;

export function CustomerEditPanel({
  kunnr,
  customer,
  disabled,
}: {
  kunnr: string;
  customer: CanonicalCustomer;
  disabled?: boolean;
}) {
  const router = useRouter();
  const fields = React.useMemo(() => customerEditableFields(), []);

  const [values, setValues] = React.useState<Values>(() => initialValues(customer));
  const [issues, setIssues] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  function setValue(field: string, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setIssues(({ [field]: _removed, ...rest }) => rest);
    setSaved(false);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setIssues({});

    try {
      const response = await demoFetch(`/api/admin/customers/${kunnr}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        issues?: { field: string; message: string }[];
        upstreamMessage?: string;
      } | null;

      if (!response.ok) {
        setIssues(Object.fromEntries((body?.issues ?? []).map((i) => [i.field, i.message])));
        // SAP's own words are shown here and only here: the audience is the
        // tenant's admin, who needs them to act.
        setError([body?.error, body?.upstreamMessage].filter(Boolean).join(" — "));
        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
      {CUSTOMER_EDIT_SECTIONS.map((section) => (
        <FormSection key={section.title} title={section.title}>
          {section.fields.map((name) => {
            const field = fields.find((f) => f.portalField === name);
            if (!field) return null;
            return (
              <SapField
                key={name}
                field={field}
                name={name}
                options={FIELD_OPTIONS[name]}
                value={values[name] ?? ""}
                error={issues[name]}
                disabled={disabled}
                onChange={(event) => setValue(name, event.currentTarget.value)}
              />
            );
          })}
        </FormSection>
      ))}

      <p className="text-[11.5px] text-text-dim">
        PAN and GSTIN aren&apos;t editable here. They carry the GSTN verification this customer was
        registered against and drive the tax on invoices SAP has already posted — changing one is a
        customer-master change, made in SAP with its own paper trail.
      </p>

      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-[12.5px] text-success">
          Saved to SAP.
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={busy} disabled={disabled}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

function initialValues(customer: CanonicalCustomer): Values {
  return {
    tradeName: customer.tradeName ?? "",
    street: customer.address.street,
    city: customer.address.city,
    state: customer.address.region,
    pinCode: customer.address.postalCode,
    country: customer.address.country,
    contactPerson: customer.contact.contactPerson,
    email: customer.contact.email,
    phone: customer.contact.phone,
  };
}
