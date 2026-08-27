"use client";

import { RouteError } from "@/components/RouteError";

export default function AuthError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} title="We couldn't load the sign-in page" />;
}
