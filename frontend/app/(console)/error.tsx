"use client";

import { RouteError } from "@/components/RouteError";

export default function ConsoleError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} title="This console screen couldn't load" />;
}
