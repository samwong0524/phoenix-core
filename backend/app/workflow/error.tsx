"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "../_components/error-boundary";
import { RouteErrorCard } from "../_components/route-error-card";

export default function WorkflowError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Workflow Route Error]", error);
  }, [error]);

  return (
    <ErrorBoundary name="Workflow" fallback={<RouteErrorCard name="Workflow" error={error} reset={reset} />}>
      <RouteErrorCard name="Workflow" error={error} reset={reset} />
    </ErrorBoundary>
  );
}
