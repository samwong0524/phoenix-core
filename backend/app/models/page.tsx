"use client";

import { useEffect, useState } from "react";

export default function ModelsPage() {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if FreeLLMAPI frontend is running on port 5173
    const check = async () => {
      try {
        const res = await fetch("http://localhost:5173/", { method: "HEAD", mode: "no-cors" });
        setAvailable(true);
      } catch {
        setAvailable(false);
      }
    };
    check();
  }, []);

  if (available === false) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 16,
          padding: 48,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 48 }}>⚙️</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>模型管理未启动</div>
        <div style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 480, lineHeight: 1.6 }}>
          FreeLLMAPI 前端 (localhost:5173) 当前未运行。请先启动 FreeLLMAPI 服务，然后刷新此页面。
        </div>
      </div>
    );
  }

  return (
    <iframe
      src="http://localhost:5173/"
      style={{
        width: "100%",
        height: "100vh",
        border: "none",
      }}
      title="模型管理"
    />
  );
}
