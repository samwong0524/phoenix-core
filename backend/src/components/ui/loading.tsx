import React from "react";

type LoadingProps = {
  variant?: "spinner" | "skeleton";
  lines?: number;
  fullPage?: boolean;
};

function Spinner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          border: "2px solid var(--border)",
          borderTopColor: "var(--cyan)",
          borderRadius: "50%",
          animation: "phx-spin 0.8s linear infinite",
        }}
      />
    </div>
  );
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  const widths = ["100%", "70%", "85%", "60%", "90%", "75%"];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        padding: "var(--space-5) 0",
      }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 16,
            width: widths[i % widths.length],
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-card)",
            animation: "pulse-glow 2s ease-in-out infinite",
          }}
        />
      ))}
    </div>
  );
}

export function Loading({ variant = "spinner", lines, fullPage = false }: LoadingProps) {
  const content = variant === "skeleton" ? <Skeleton lines={lines} /> : <Spinner />;

  if (fullPage) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "var(--bg-void)",
        }}
      >
        {content}
      </div>
    );
  }

  return content;
}
