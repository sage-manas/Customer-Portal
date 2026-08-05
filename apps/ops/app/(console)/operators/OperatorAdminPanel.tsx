"use client";

import { ROLES, isPlatformRole, type Role } from "@cc/domain";
import type { OperatorListItem } from "@cc/service-platform";
import { Badge, Button, Input, Select } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * Operator user management (doc 09 §3.3) — `super_admin` only.
 *
 * The role choices are `ROLES.filter(isPlatformRole)`, not a literal pair:
 * a role added to the platform group in `auth.ts` appears here with nothing
 * to edit, and — more to the point — a tenant role can never be offered,
 * because the same predicate the token parse and `operatorLogin` use is
 * what builds the list (ADR-051).
 */

const PLATFORM_ROLES = ROLES.filter(isPlatformRole);

export function OperatorAdminPanel({
  operators,
  currentOperatorId,
}: {
  operators: OperatorListItem[];
  currentOperatorId: string;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [created, setCreated] = React.useState<{ email: string; password: string } | null>(null);

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setCreated(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/operators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        roles: [String(form.get("role") ?? "")],
      }),
    });
    setPending(false);

    const body = (await response.json().catch(() => null)) as {
      error?: string;
      operator?: OperatorListItem;
      temporaryPassword?: string;
    } | null;

    if (!response.ok || !body?.operator) {
      setError(body?.error ?? "That didn't go through.");
      return;
    }

    setCreated({ email: body.operator.email, password: body.temporaryPassword ?? "" });
    router.refresh();
  }

  async function onToggleActive(operator: OperatorListItem) {
    setError(null);
    const response = await fetch(`/api/operators/${operator.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !operator.isActive }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "That didn't go through.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Operator
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Roles
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Status
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Last sign-in
              </th>
              <th scope="col" className="px-4 py-2 font-bold" />
            </tr>
          </thead>
          <tbody>
            {operators.map((operator) => (
              <tr key={operator.id} className="border-t border-border">
                <td className="px-4 py-2.5 align-top">
                  <span className="text-text">{operator.email}</span>
                  {operator.id === currentOperatorId ? (
                    <span className="ml-2 text-[11px] text-text-dim">(you)</span>
                  ) : null}
                  {operator.mustChangePassword ? (
                    <div className="text-[11px] text-text-dim">Password change pending</div>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex flex-wrap gap-1">
                    {operator.roles.length === 0 ? (
                      <Badge variant="danger">No platform role</Badge>
                    ) : (
                      operator.roles.map((role) => (
                        <Badge key={role} variant="neutral">
                          {role}
                        </Badge>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 align-top">
                  <Badge variant={operator.isActive ? "success" : "danger"}>
                    {operator.isActive ? "Active" : "Deactivated"}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 align-top text-text-mid">
                  {operator.lastLoginAt ? operator.lastLoginAt.toLocaleString() : "Never"}
                </td>
                <td className="px-4 py-2.5 align-top">
                  <Button
                    size="sm"
                    variant={operator.isActive ? "destructive" : "secondary"}
                    disabled={operator.id === currentOperatorId && operator.isActive}
                    onClick={() => onToggleActive(operator)}
                  >
                    {operator.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={onCreate}
        className="flex max-w-md flex-col gap-4 rounded-md border border-border bg-surface p-5"
      >
        <h2 className="text-[12.5px] font-bold text-text">Add an operator</h2>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[12.5px] font-medium text-text-mid">
            Email
          </label>
          <Input id="email" name="email" type="email" required placeholder="ops@platform.example" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="role" className="text-[12.5px] font-medium text-text-mid">
            Role
          </label>
          <Select
            id="role"
            name="role"
            defaultValue={"sap_manager" satisfies Role}
            options={PLATFORM_ROLES.map((role) => ({ value: role, label: role }))}
          />
          <p className="text-[11px] text-text-dim">
            Platform roles only — a tenant role in this realm grants nothing and is refused at
            sign-in.
          </p>
        </div>

        <p role="alert" aria-live="polite" className="min-h-[18px] text-[12px] text-danger">
          {error}
        </p>

        <Button type="submit" loading={pending} className="w-fit">
          Create operator
        </Button>

        {created ? (
          <div className="rounded-sm bg-background p-3 text-[12px]">
            <p className="text-text">One-time password for {created.email}:</p>
            <p className="mt-1 font-mono">{created.password}</p>
            <p className="mt-1 text-[11px] text-text-dim">
              Shown once. They will be asked to change it at first sign-in.
            </p>
          </div>
        ) : null}
      </form>
    </div>
  );
}
