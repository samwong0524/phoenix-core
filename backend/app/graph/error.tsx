"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "../_components/error-boundary";
import { RouteErrorCard } from "../_components/route-error-card";

export default function GraphError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Graph Route Error]", error);
  }, [error]);

  return (
    <ErrorBoundary name="Graph" fallback={<RouteErrorCard name="Graph" error={error} reset={reset} />}>
      <RouteErrorCard name="Graph" error={error} reset={reset} />
    </ErrorBoundary>
  );
}
