"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "../_components/error-boundary";
import { RouteErrorCard } from "../_components/route-error-card";

export default function ModelsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Models Route Error]", error);
  }, [error]);

  return (
    <ErrorBoundary name="Models" fallback={<RouteErrorCard name="Models" error={error} reset={reset} />}>
      <RouteErrorCard name="Models" error={error} reset={reset} />
    </ErrorBoundary>
  );
}
