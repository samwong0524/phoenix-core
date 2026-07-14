"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "../_components/error-boundary";
import { RouteErrorCard } from "../_components/route-error-card";

export default function OrchestrateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Orchestrate Route Error]", error);
  }, [error]);

  return (
    <ErrorBoundary name="Orchestrate" fallback={<RouteErrorCard name="Orchestrate" error={error} reset={reset} />}>
      <RouteErrorCard name="Orchestrate" error={error} reset={reset} />
    </ErrorBoundary>
  );
}
