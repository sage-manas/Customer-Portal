"use client";

import { sapConnectionFields, type SapDriverKind } from "@cc/domain";
import type { SapConnectionFieldState, SapConnectionTestResult } from "@cc/service-platform";
import { Badge, Button, Input, Select } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

// TODO(BACKEND): swap `demoFetch` back to `fetch` once /api/* is migrated.
import { demoFetch } from "@/lib/demo-fetch";

/**
 * The per-tenant SAP connection form (doc 09 §3.3).
 *
 * Not one field is named in this file. The inputs come from
 * `sapConnectionFields(driver)` in @cc/domain — the same registry the
 * service validates against and the resolver reads back — so a new
 * connection parameter is a row there and nothing here changes (CLAUDE.md
 * rule 3). Switching the driver select re-renders the form from that
 * registry rather than from a second copy of "what ECC needs".
 *
 * Secrets are write-only. A stored one renders as "Set" with an empty
 * input: leaving it empty keeps it, typing replaces it, and "Clear" is an
 * explicit checkbox. That is why the server sends `isSet` and not a value —
 * a password round-tripped into an input is a password in the page cache,
 * the browser's autofill store and any screenshot of this screen.
 */

const DRIVER_OPTIONS = [
  { value: "mock", label: "mock — simulated, always available" },
  { value: "ecc", label: "ecc — RFC/BAPI (not certified yet)" },
  { value: "s4", label: "s4 — OData (not certified yet)" },
];

export function SapConfigForm({
  tenantId,
  driver: storedDriver,
  fields,
}: {
  tenantId: string;
  driver: SapDriverKind;
  fields: SapConnectionFieldState[];
}) {
  const router = useRouter();
  const [driver, setDriver] = React.useState<SapDriverKind>(storedDriver);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [clearing, setClearing] = React.useState<Record<string, boolean>>({});
  const [pending, setPending] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [test, setTest] = React.useState<SapConnectionTestResult | null>(null);

  // Stored state applies to the *stored* driver only: pointing a tenant at
  // a different system is not a reason to claim its old password is set.
  const storedByKey = new Map(
    driver === storedDriver ? fields.map((field) => [field.key, field]) : [],
  );
  const registryFields = sapConnectionFields(driver);

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(null);
    setTest(null);

    const response = await demoFetch(`/api/tenants/${tenantId}/sap-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driver,
        params: Object.fromEntries(registryFields.map((f) => [f.key, values[f.key] ?? ""])),
        clearSecrets: Object.entries(clearing)
          .filter(([, on]) => on)
          .map(([key]) => key),
      }),
    });
    setPending(false);

    const body = (await response.json().catch(() => null)) as {
      error?: string;
      changedFields?: string[];
      missing?: string[];
    } | null;

    if (!response.ok) {
      setError(body?.error ?? "That didn't go through.");
      return;
    }

    const changed = body?.changedFields ?? [];
    setSaved(
      changed.length === 0
        ? "Saved — no connection parameter changed."
        : `Saved. Updated: ${changed.join(", ")}.`,
    );
    setValues({});
    setClearing({});
    router.refresh();
  }

  async function onTest() {
    setTesting(true);
    setError(null);
    const response = await demoFetch(`/api/tenants/${tenantId}/sap-config/test`, { method: "POST" });
    setTesting(false);

    const body = (await response.json().catch(() => null)) as
      (SapConnectionTestResult & { error?: string }) | null;

    if (!response.ok || !body) {
      setError(body?.error ?? "The connection test could not be run.");
      return;
    }
    setTest(body);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSave}
      className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="driver" className="text-[12.5px] font-medium text-text-mid">
          Driver
        </label>
        <Select
          id="driver"
          value={driver}
          options={DRIVER_OPTIONS}
          onChange={(event) => {
            setDriver(event.target.value as SapDriverKind);
            setValues({});
            setClearing({});
          }}
        />
        {driver !== "mock" ? (
          <p className="text-[11px] text-text-dim">
            The ecc and s4 drivers are Track C skeletons: the portal stores and uses this
            configuration, and the drivers still refuse real calls until certification (ADR-006).
          </p>
        ) : null}
      </div>

      {registryFields.length === 0 ? (
        <p className="rounded-sm bg-background p-3 text-[12px] text-text-dim">
          The mock driver has no external system to reach, so there is nothing to configure. Saving
          with this driver selected clears any stored connection for this tenant.
        </p>
      ) : (
        registryFields.map((field) => {
          const stored = storedByKey.get(field.key);
          return (
            <div key={field.key} className="flex flex-col gap-1.5">
              <label
                htmlFor={`field-${field.key}`}
                className="flex items-center gap-2 text-[12.5px] font-medium text-text-mid"
              >
                {field.label}
                {field.required ? <span className="text-danger">*</span> : null}
                {field.secret ? (
                  <Badge variant={stored?.isSet ? "success" : "neutral"}>
                    {stored?.isSet ? "Set" : "Not set"}
                  </Badge>
                ) : null}
              </label>
              <Input
                id={`field-${field.key}`}
                type={field.secret ? "password" : "text"}
                autoComplete={field.secret ? "new-password" : "off"}
                placeholder={
                  field.secret && stored?.isSet
                    ? "Leave blank to keep the stored value"
                    : field.placeholder
                }
                defaultValue={field.secret ? "" : (stored?.value ?? "")}
                disabled={clearing[field.key] === true}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
              {field.help ? <p className="text-[11px] text-text-dim">{field.help}</p> : null}
              {field.secret && stored?.isSet ? (
                <label className="flex items-center gap-2 text-[11.5px] text-text-dim">
                  <input
                    type="checkbox"
                    checked={clearing[field.key] === true}
                    onChange={(event) =>
                      setClearing((current) => ({ ...current, [field.key]: event.target.checked }))
                    }
                  />
                  Clear the stored value
                </label>
              ) : null}
            </div>
          );
        })
      )}

      <p role="alert" aria-live="polite" className="min-h-[18px] text-[12px]">
        {error ? <span className="text-danger">{error}</span> : null}
        {saved ? <span className="text-success">{saved}</span> : null}
      </p>

      <div className="flex items-center gap-2">
        <Button type="submit" loading={pending}>
          Save configuration
        </Button>
        <Button type="button" variant="secondary" loading={testing} onClick={onTest}>
          Test connection
        </Button>
      </div>

      {test ? (
        <div className="rounded-sm border border-border bg-background p-3 text-[12px]">
          <Badge variant={test.reachable ? "success" : "danger"}>
            {test.reachable ? "Reachable" : "Not reachable"}
          </Badge>
          <span className="ml-2 text-text-mid">
            driver {test.driver} · circuit {test.circuit} · checked{" "}
            {new Date(test.checkedAt).toLocaleTimeString()}
          </span>
          {test.error ? <p className="mt-1 text-text-dim">{test.error}</p> : null}
        </div>
      ) : null}
    </form>
  );
}
