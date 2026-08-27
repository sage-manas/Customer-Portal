import { PageHeader } from "@cc/ui";

import { ProvisionForm } from "./ProvisionForm";

import { requireOperatorPage } from "@/lib/page-guard";

export default async function NewTenantPage() {
  await requireOperatorPage("platform:tenant-crud");

  return (
    <div className="max-w-lg">
      <PageHeader
        title="Provision tenant"
        subtitle="Creates the tenant and its first client_admin login. SAP/GSTN/payment-gateway drivers default to mock — point the tenant at a real system from SAP Config once credentials exist."
      />
      <div className="mt-6">
        <ProvisionForm />
      </div>
    </div>
  );
}
