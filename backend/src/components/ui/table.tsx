"use client";

import React, { useState } from "react";

type Column<T> = {
  key: string;
  header: string;
  width?: string | number;
  render?: (value: any, row: T, index: number) => React.ReactNode;
};

type TableProps<T> = {
  columns: Column<T>[];
  data: T[];
  emptyText?: string;
  onRowClick?: (row: T, index: number) => void;
  style?: React.CSSProperties;
};

const wrapperStyle: React.CSSProperties = {
  overflowX: "auto",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  background: "var(--bg-card)",
};

const tdBaseStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "var(--text-primary)",
  borderBottom: "1px solid var(--border-hairline)",
};

const tdLastRowStyle: React.CSSProperties = {
  borderBottom: "none",
};

export function Table<T extends Record<string, any>>({
  columns,
  data,
  emptyText = "No data",
  onRowClick,
  style,
}: TableProps<T>) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div style={{ ...wrapperStyle, ...style }}>
        <div
          style={{
            textAlign: "center",
            padding: 48,
            color: "var(--text-dim)",
            fontSize: 13,
          }}
        >
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...wrapperStyle, ...style }}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  ...thStyle,
                  ...(col.width !== undefined ? { width: col.width } : {}),
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => {
            const isLast = rowIndex === data.length - 1;
            const isHovered = hoveredRow === rowIndex;
            return (
              <tr
                key={rowIndex}
                style={{
                  ...(isHovered ? { background: "var(--bg-hover)" } : {}),
                  ...(onRowClick ? { cursor: "pointer" } : {}),
                }}
                onMouseEnter={() => setHoveredRow(rowIndex)}
                onMouseLeave={() => setHoveredRow(null)}
                onClick={() => onRowClick?.(row, rowIndex)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      ...tdBaseStyle,
                      ...(isLast ? tdLastRowStyle : {}),
                    }}
                  >
                    {col.render
                      ? col.render(row[col.key], row, rowIndex)
                      : row[col.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
