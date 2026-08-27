import { listOperators } from "@cc/service-platform";
import { PageHeader, SapUnavailable } from "@cc/ui";

import { OperatorAdminPanel } from "./OperatorAdminPanel";

import { requireOperatorPage } from "@/lib/page-guard";
import { safeRead } from "@/lib/safe-read";

export const dynamic = "force-dynamic";

export default async function OperatorsPage() {
  const session = await requireOperatorPage("platform:operators-manage");

  const result = await safeRead(() => listOperators());

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Operators"
          subtitle="Console logins. Creating one is the ability to create any of them, which is why this tab is super-admin only (doc 09 §2)."
        />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const operators = result.data;

  return (
    <>
      <PageHeader
        title="Operators"
        subtitle="Console logins. Creating one is the ability to create any of them, which is why this tab is super-admin only (doc 09 §2)."
      />
      <OperatorAdminPanel operators={operators} currentOperatorId={session.operatorId} />
    </>
  );
}
