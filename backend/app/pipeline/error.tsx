"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "../_components/error-boundary";
import { RouteErrorCard } from "../_components/route-error-card";

export default function PipelineError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Pipeline Route Error]", error);
  }, [error]);

  return (
    <ErrorBoundary name="Pipeline" fallback={<RouteErrorCard name="Pipeline" error={error} reset={reset} />}>
      <RouteErrorCard name="Pipeline" error={error} reset={reset} />
    </ErrorBoundary>
  );
}
