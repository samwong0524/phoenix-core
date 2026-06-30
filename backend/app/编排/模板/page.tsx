import { Suspense } from "react";
import WorkflowTemplateGallery from "@/app/_components/workflow-template-gallery";

export default function WorkflowTemplatesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 60, textAlign: "center", color: "var(--text-dim)" }}>Loading...</div>}>
      <WorkflowTemplateGallery />
    </Suspense>
  );
}
