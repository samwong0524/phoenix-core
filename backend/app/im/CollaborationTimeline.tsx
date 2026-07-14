"use client";

import { memo } from "react";
import type { TimelineEvent } from "./types";

export interface CollaborationTimelineProps {
  events: TimelineEvent[];
}

/**
 * Chronological timeline of collaboration events (task assignments).
 * Displayed in TaskMonitor for team groups to show who assigned whom.
 */
export const CollaborationTimeline = memo(function CollaborationTimeline({
  events,
}: CollaborationTimelineProps) {
  if (events.length === 0) {
    return (
      <div
        style={{
          padding: "12px",
          fontSize: 12,
          color: "var(--text-dim, #666)",
          textAlign: "center",
        }}
      >
        暂无协作事件
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 12px" }}>
      {events.map((event, idx) => (
        <div
          key={event.id}
          style={{
            display: "flex",
            gap: 8,
            marginBottom: idx < events.length - 1 ? 10 : 0,
            alignItems: "flex-start",
          }}
        >
          {/* Timeline dot */}
          <div
            style={{
              marginTop: 4,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--cyan, #06b6d4)",
              flexShrink: 0,
            }}
          />

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim, #666)",
                marginBottom: 2,
              }}
            >
              {new Date(event.timestamp).toLocaleTimeString()}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 600, color: "var(--text-primary, #e2e8f0)" }}>
                {event.coordinatorRole}
              </span>
              <span style={{ color: "var(--text-secondary, #aaa)" }}> 分配 </span>
              <span
                style={{
                  fontWeight: 600,
                  color: "var(--cyan, #06b6d4)",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                {event.assigneeRole}
              </span>
              {event.taskDescription && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: "var(--text-dim, #666)",
                    fontFamily: "var(--font-mono, monospace)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {event.taskDescription}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});
