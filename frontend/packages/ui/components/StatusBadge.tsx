import { statusBadgeVariant, type CanonicalStatus } from "@cc/domain/status";

import { Badge } from "../primitives/badge";

const STATUS_LABELS: Record<CanonicalStatus, string> = {
  Draft: "Draft",
  Submitted: "Submitted",
  PendingApproval: "Pending Approval",
  Approved: "Approved",
  Rejected: "Rejected",
  Open: "Open",
  Confirmed: "Confirmed",
  CreditHold: "Credit Hold",
  InProcess: "In Process",
  Picked: "Picked",
  Packed: "Packed",
  InTransit: "In Transit",
  Delivered: "Delivered",
  PartiallyDelivered: "Partially Delivered",
  Invoiced: "Invoiced",
  Overdue: "Overdue",
  Paid: "Paid",
  Cleared: "Cleared",
  Disputed: "Disputed",
  Resolved: "Resolved",
  Closed: "Closed",
};

export interface StatusBadgeProps {
  status: CanonicalStatus;
  className?: string;
}

/**
 * Renders a canonical status. Never pass a raw SAP code here — translate it
 * first via the mapper functions in @cc/domain/status (e.g.
 * mapOrderGbstkToStatus) so the raw-code -> color mapping lives in exactly
 * one place (docs/05-UI-UX-DESIGN.md §6.5).
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge variant={statusBadgeVariant[status]} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
