"use client";

import { RouteError } from "@/components/RouteError";

export default function AdminError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} title="This desk couldn't load" />;
}
