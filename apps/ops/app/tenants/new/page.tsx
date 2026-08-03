import { PageHeader } from "@cc/ui";
import { redirect } from "next/navigation";

import { ProvisionForm } from "./ProvisionForm";

import { getOperatorSession } from "@/lib/session";

export default async function NewTenantPage() {
  const session = await getOperatorSession();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto max-w-lg px-6 py-8">
      <PageHeader
        title="Provision tenant"
        subtitle="Creates the tenant and its first client_admin login. SAP/GSTN/payment-gateway drivers default to mock — switch them from the credential vault once real credentials exist."
      />
      <div className="mt-6">
        <ProvisionForm />
      </div>
    </main>
  );
}
