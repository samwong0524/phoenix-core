"use client";

import React, { useState } from "react";

type CardProps = {
  children: React.ReactNode;
  padding?: number | string;
  borderRadius?: string | number;
  hoverable?: boolean;
  hoverBorderColor?: string;
  accentBorder?: { side: "left" | "top"; color: string; width?: number };
  background?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
};

export function Card({
  children,
  padding = 16,
  borderRadius = "var(--radius-lg)",
  hoverable = false,
  hoverBorderColor = "var(--cyan-dim)",
  accentBorder,
  background = "var(--bg-card)",
  title,
  className,
  style,
  onClick,
}: CardProps) {
  const [hovered, setHovered] = useState(false);

  const baseStyle: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius,
    background,
    overflow: "hidden",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
    ...(hoverable && hovered ? { borderColor: hoverBorderColor, boxShadow: "0 0 12px var(--cyan-glow)" } : {}),
    ...(accentBorder
      ? { [`border${accentBorder.side.charAt(0).toUpperCase() + accentBorder.side.slice(1)}Width`]: accentBorder.width ?? 3,
          [`border${accentBorder.side.charAt(0).toUpperCase() + accentBorder.side.slice(1)}Color`]: accentBorder.color }
      : {}),
    ...(onClick ? { cursor: "pointer" } : {}),
    ...style,
  };

  const content = (
    <>
      {title && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--text-secondary)",
            fontFamily: "var(--font-display)",
            letterSpacing: "0.5px",
          }}
        >
          {title}
        </div>
      )}
      <div style={{ padding }}>{children}</div>
    </>
  );

  if (onClick) {
    return (
      <div
        className={className}
        style={baseStyle}
        onClick={onClick}
        onMouseEnter={() => hoverable && setHovered(true)}
        onMouseLeave={() => hoverable && setHovered(false)}
        role="button"
        tabIndex={0}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={baseStyle}
      onMouseEnter={() => hoverable && setHovered(true)}
      onMouseLeave={() => hoverable && setHovered(false)}
    >
      {content}
    </div>
  );
}
