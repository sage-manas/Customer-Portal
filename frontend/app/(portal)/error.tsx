"use client";

import { RouteError } from "@/components/RouteError";

export default function PortalError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} />;
}
