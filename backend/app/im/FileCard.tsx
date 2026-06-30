export function FileCard({ url, name, size }: { url: string; name: string; size?: number }) {
  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const ext = name.split(".").pop()?.toUpperCase() || "";

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        textDecoration: "none",
        color: "var(--text-primary)",
        cursor: "pointer",
        maxWidth: 280,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "var(--radius-sm)",
          background: "var(--cyan)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          color: "#000",
          flexShrink: 0,
          fontFamily: "var(--font-mono)",
        }}
      >
        {ext.slice(0, 3)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </div>
        {size ? <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{fmtSize(size)}</div> : null}
      </div>
      <span style={{ fontSize: 16, color: "var(--text-dim)" }}>↓</span>
    </a>
  );
}
