"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "../_components/error-boundary";
import { RouteErrorCard } from "../_components/route-error-card";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Settings Route Error]", error);
  }, [error]);

  return (
    <ErrorBoundary name="Settings" fallback={<RouteErrorCard name="Settings" error={error} reset={reset} />}>
      <RouteErrorCard name="Settings" error={error} reset={reset} />
    </ErrorBoundary>
  );
}
