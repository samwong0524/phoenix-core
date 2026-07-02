"use client";

import { useWorkflowStore } from "./store";

export default function NodePalette() {
  const availableRoles = useWorkflowStore((s) => s.availableRoles);

  function onDragStartAgent(e: React.DragEvent, role: string) {
    e.dataTransfer.setData("application/workflow-role", role);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragStartCondition(e: React.DragEvent) {
    e.dataTransfer.setData("application/workflow-node-type", "condition");
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="w-[200px] border-r border-border bg-panel flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3.5 py-3 border-b border-border text-[11px] font-bold text-primary font-[family-name:var(--font-display)] uppercase tracking-[0.1em]">
        Nodes
      </div>

      <div className="px-3.5 py-3 overflow-y-auto flex-1">
        {/* Control Flow section */}
        <div className="text-[11px] font-semibold text-text-dim mb-2 uppercase tracking-[0.05em]">
          Control Flow
        </div>
        <div
          draggable
          onDragStart={onDragStartCondition}
          className="px-3 py-2 bg-card border border-purple/20 rounded-[8px] cursor-grab text-xs font-semibold font-[family-name:var(--font-mono)] text-purple mb-4 transition-all duration-150 hover:border-purple hover:shadow-[0_2px_6px_rgba(0,0,0,0.12)]"
        >
          ◇ Condition
        </div>

        {/* Agent Nodes section */}
        <div className="text-[11px] font-semibold text-text-dim mb-2 uppercase tracking-[0.05em]">
          Agent Nodes
        </div>
        <div className="text-[11px] text-text-dim mb-3 leading-normal">
          Drag a role onto the canvas.
        </div>

        {/* Role list */}
        <div className="flex flex-col gap-1.5">
          {(availableRoles.length > 0 ? availableRoles : ["assistant", "coordinator", "researcher", "creator", "reviewer", "specialist"]).map(
            (role) => (
              <div
                key={role}
                draggable
                onDragStart={(e) => onDragStartAgent(e, role)}
                className="px-3 py-2 bg-card border border-border rounded-[8px] cursor-grab text-xs font-semibold font-[family-name:var(--font-mono)] text-primary transition-all duration-150 hover:border-primary-dim hover:shadow-[0_2px_6px_rgba(0,0,0,0.12)]"
              >
                + {role}
              </div>
            )
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="px-3.5 py-3 border-t border-border">
        <div className="text-[10px] text-text-dim leading-relaxed">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-green inline-block" />
            Start
          </div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2.5 h-2.5 rounded bg-card border border-border inline-block" />
            Agent Step
          </div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2.5 h-2.5 rotate-45 bg-card border border-purple inline-block" />
            Condition
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red inline-block" />
            End
          </div>
        </div>
      </div>
    </div>
  );
}
