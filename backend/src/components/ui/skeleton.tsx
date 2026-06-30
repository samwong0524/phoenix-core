"use client";

import React from "react";

type SkeletonVariant = "line" | "circle" | "rect";

type SkeletonProps = {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  count?: number;
  animated?: boolean;
  style?: React.CSSProperties;
};

const lineWidths = ["100%", "70%", "85%", "60%", "90%", "75%"];

const baseStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  borderRadius: "var(--radius-sm)",
};

const animatedStyle: React.CSSProperties = {
  animation: "pulse-glow 2s ease-in-out infinite",
};

function SkeletonLine({
  count = 3,
  width,
  height = 16,
  animated,
  style,
}: {
  count: number;
  width?: string | number;
  height?: string | number;
  animated: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            ...baseStyle,
            height,
            width: width ?? lineWidths[i % lineWidths.length],
            ...(animated ? animatedStyle : {}),
            ...style,
          }}
        />
      ))}
    </div>
  );
}

function SkeletonCircle({
  width = 40,
  height = 40,
  animated,
  style,
}: {
  width?: string | number;
  height?: string | number;
  animated: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        ...baseStyle,
        width,
        height,
        borderRadius: "50%",
        ...(animated ? animatedStyle : {}),
        ...style,
      }}
    />
  );
}

function SkeletonRect({
  width = "100%",
  height = 100,
  animated,
  style,
}: {
  width?: string | number;
  height?: string | number;
  animated: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        ...baseStyle,
        width,
        height,
        ...(animated ? animatedStyle : {}),
        ...style,
      }}
    />
  );
}

export function Skeleton({
  variant = "line",
  width,
  height,
  count = 3,
  animated = true,
  style,
}: SkeletonProps) {
  if (variant === "circle") {
    return (
      <SkeletonCircle
        width={width}
        height={height}
        animated={animated}
        style={style}
      />
    );
  }

  if (variant === "rect") {
    return (
      <SkeletonRect
        width={width}
        height={height}
        animated={animated}
        style={style}
      />
    );
  }

  return (
    <SkeletonLine
      count={count}
      width={width}
      height={height}
      animated={animated}
      style={style}
    />
  );
}
