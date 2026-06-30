"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "../_components/error-boundary";
import { RouteErrorCard } from "../_components/route-error-card";

export default function IMError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[IM Route Error]", error);
  }, [error]);

  return (
    <ErrorBoundary name="IM" fallback={<RouteErrorCard name="IM" error={error} reset={reset} />}>
      <RouteErrorCard name="IM" error={error} reset={reset} />
    </ErrorBoundary>
  );
}
