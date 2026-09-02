import type { Role } from "@cc/domain";

/**
 * The seeded accounts the development role picker offers.
 *
 * Presentation only — labels and descriptions for a list of buttons. The
 * authority on what any of these may do is the database row plus the
 * permission registry in `@cc/domain`; nothing here grants anything, and an
 * email listed below that has not been seeded simply fails to sign in.
 *
 * Kept next to the UI that renders it rather than inside a service, because
 * `prisma/seed.ts` is what creates these rows and this is a description of
 * that seed, not a source of truth about users.
 */
export interface DevAccount {
  email: string;
  label: string;
  description: string;
  roles: Role[];
}

export const DEV_ACCOUNTS: readonly DevAccount[] = [
  {
    email: "buyer@acme-industrial.example",
    label: "Customer",
    description: "The buyer plane: catalogue, orders, invoices, payments, support.",
    roles: ["customer"],
  },
  {
    email: "admin@acme-industrial.example",
    label: "Client Admin",
    description: "The tenant back office: everything AP, AR and ops staff can do.",
    roles: ["client_admin"],
  },
  {
    email: "ap@acme-industrial.example",
    label: "AP Manager",
    description: "Accounts Payable: refunds, rebate settlement, the reconciliation tray.",
    roles: ["ap_manager"],
  },
  {
    email: "ar@acme-industrial.example",
    label: "AR Manager",
    description: "Accounts Receivable: the invoice register and credit-block releases.",
    roles: ["ar_manager"],
  },
  {
    email: "ops@customerconnect.example",
    label: "Super Admin",
    description: "The platform console: tenants, SAP config, operators, billing.",
    roles: ["super_admin"],
  },
  {
    email: "sap@customerconnect.example",
    label: "SAP Manager",
    description: "The platform console, narrowed: SAP Config and SAP Health only.",
    roles: ["sap_manager"],
  },
] as const;
