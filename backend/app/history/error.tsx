"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "../_components/error-boundary";
import { RouteErrorCard } from "../_components/route-error-card";

export default function HistoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[History Route Error]", error);
  }, [error]);

  return (
    <ErrorBoundary name="History" fallback={<RouteErrorCard name="History" error={error} reset={reset} />}>
      <RouteErrorCard name="History" error={error} reset={reset} />
    </ErrorBoundary>
  );
}
