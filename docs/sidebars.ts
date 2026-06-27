import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docSidebar: [
    "intro",
    {
      type: "category",
      label: "Architecture",
      link: { type: "doc", id: "architecture/overview" },
      items: ["architecture/core-concepts", "architecture/agent-system", "architecture/workflow-engine", "architecture/tool-system", "architecture/mcp-integration"],
    },
    {
      type: "category",
      label: "API Reference",
      link: { type: "doc", id: "api/overview" },
      items: ["api/agents", "api/groups", "api/workflows", "api/memories"],
    },
    {
      type: "category",
      label: "Deployment",
      link: { type: "doc", id: "deployment/overview" },
      items: ["deployment/quickstart", "deployment/configuration", "deployment/production"],
    },
  ],
};

export default sidebars;
