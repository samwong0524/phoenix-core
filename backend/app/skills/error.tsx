"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "../_components/error-boundary";
import { RouteErrorCard } from "../_components/route-error-card";

export default function SkillsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Skills Route Error]", error);
  }, [error]);

  return (
    <ErrorBoundary name="Skills" fallback={<RouteErrorCard name="Skills" error={error} reset={reset} />}>
      <RouteErrorCard name="Skills" error={error} reset={reset} />
    </ErrorBoundary>
  );
}
