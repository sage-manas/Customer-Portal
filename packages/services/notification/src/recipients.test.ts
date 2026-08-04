import {
  NOTIFICATION_TEMPLATES,
  ROLES,
  isBackOfficeRole,
  isCustomerRole,
  rolesWithPermission,
} from "@cc/domain";
import type { NotificationTemplate, Permission, Role } from "@cc/domain";
import { describe, expect, it } from "vitest";

/**
 * The five-tier collapse, checked against the recipient rules (doc 09 §3.2:
 * "verify A7 queries still resolve after the collapse").
 *
 * `resolveRecipients` turns a template's `permission` into a SQL `roles
 * hasSome [...]` via `rolesWithPermission` (ADR-041). That indirection is
 * what makes the fan-out survive a role rename — and also what makes a
 * mistake in the permission table silent: nothing throws when
 * `rolesWithPermission` returns `[]`, the query simply matches nobody and
 * an event that used to notify a queue stops notifying anyone.
 *
 * These are registry assertions, not database ones — the integration suite
 * in `__tests__/notification-flow.test.ts` covers the queries themselves.
 * The property being pinned here is the one the collapse could have broken
 * without any test failing: that every template still *has* a non-empty
 * recipient set, on the right plane.
 */

const templates: NotificationTemplate[] = Object.values(NOTIFICATION_TEMPLATES)
  .flat()
  .filter((template): template is NotificationTemplate => Boolean(template));

function eligible(permission: Permission): Role[] {
  return rolesWithPermission(permission);
}

describe("recipient resolution after the five-tier collapse", () => {
  it("has templates to check (guards against an empty registry passing vacuously)", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates.map((t) => [t.key, t] as const))(
    "%s resolves to at least one role under the new registry",
    (_key, template) => {
      expect(eligible(template.permission)).not.toHaveLength(0);
    },
  );

  it.each(templates.filter((t) => t.audience === "back_office").map((t) => [t.key, t] as const))(
    "%s (back_office) still has a back-office role holding its permission",
    (_key, template) => {
      // `resolveRecipients` intersects the eligible roles with
      // `isBackOfficeRole` and returns [] when that intersection is empty.
      // Under the old model `tenant_*` roles satisfied this by name; under
      // the new one it is a property of the permission table (ADR-048), so
      // it is worth asserting rather than assuming.
      expect(eligible(template.permission).filter(isBackOfficeRole)).not.toHaveLength(0);
    },
  );

  it.each(templates.filter((t) => t.audience === "customer").map((t) => [t.key, t] as const))(
    "%s (customer) is reachable by the consolidated customer role",
    (_key, template) => {
      expect(eligible(template.permission).filter(isCustomerRole)).not.toHaveLength(0);
    },
  );

  it("never lets a platform role become a recipient of a tenant notification", () => {
    // Doc 09 §1: platform roles hold zero tenant-data permissions. If one
    // ever did, it would be selected by a `hasSome` in a tenant's own
    // `runWithTenant` scope — and an operator has no `User` row, so the row
    // would be a tenant user wrongly holding a platform role. Cheap to
    // assert, and the failure mode is a cross-plane leak.
    for (const template of templates) {
      const platform = eligible(template.permission).filter(
        (role) => !isBackOfficeRole(role) && !isCustomerRole(role),
      );
      expect(platform, `${template.key} reaches a platform role`).toHaveLength(0);
    }
  });

  it("keeps the customer plane and the back-office plane disjoint per template", () => {
    // A template whose permission is held on both planes would deliver the
    // same row to a buyer and to staff — and `resolveRecipients` picks its
    // branch from `audience`, so the mismatch would never surface as an
    // error, only as the wrong people being told.
    const both = templates.filter((template) => {
      const roles = eligible(template.permission);
      return template.audience === "back_office" && roles.some(isCustomerRole);
    });
    expect(both.map((t) => t.key)).toEqual([]);
  });

  it("covers every role identifier in the model (six, no legacy survivors)", () => {
    expect([...ROLES]).toHaveLength(6);
  });
});
