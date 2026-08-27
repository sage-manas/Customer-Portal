import { hasPermission } from "@cc/domain";
import { PageHeader } from "@cc/ui";
import { notFound, redirect } from "next/navigation";

import { RegisterCustomerWizard } from "./RegisterCustomerWizard";

import { getSession } from "@/lib/session";

/**
 * Register a customer from the back office (doc 09 §3.4, ADR-056).
 *
 * The page is guarded here as well as in the API: it is the API that
 * enforces, but a screen that renders for somebody who cannot use it is a
 * worse experience than a 404.
 */

export const dynamic = "force-dynamic";

export default async function RegisterCustomerPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "customer:register")) notFound();

  return (
    <>
      <PageHeader
        title="Register customer"
        subtitle="The same four steps a customer fills in themselves — with you filling them in, and no review queue to wait at."
      />
      <RegisterCustomerWizard />
    </>
  );
}
