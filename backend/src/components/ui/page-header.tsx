"use client";

import React from "react";
import Link from "next/link";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  sticky?: boolean;
  separator?: boolean;
};

export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel = "← Back",
  actions,
  sticky = false,
  separator = false,
}: PageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: sticky ? "16px 24px" : "0 0 16px",
        borderBottom: sticky ? "1px solid var(--border)" : undefined,
        position: sticky ? "sticky" : undefined,
        top: sticky ? 0 : undefined,
        zIndex: sticky ? "var(--z-sticky)" : undefined,
        background: sticky ? "var(--bg-void)" : undefined,
      }}
    >
      {backHref && (
        <>
          <Link
            href={backHref}
            className="phx-back-link"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "var(--text-secondary)",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 500,
              transition: "color 0.2s ease",
            }}
          >
            {backLabel}
          </Link>
          {separator && (
            <div
              style={{
                width: 1,
                height: 20,
                background: "var(--border)",
              }}
            />
          )}
        </>
      )}
      <div style={{ flex: 1 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 16,
            fontFamily: "var(--font-display)",
            color: "var(--cyan)",
            fontWeight: 600,
            letterSpacing: "0.5px",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
