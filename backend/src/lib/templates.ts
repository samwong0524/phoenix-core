/**
 * Workspace template definitions.
 *
 * Each template defines a pre-configured agent team, group topology,
 * and welcome message for instant workspace creation.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface TemplateAgent {
  /** Role name — maps to roles/*.md behavior templates via resolveBehaviorRole() */
  role: string;
  /** Extra guidance passed to buildSystemPrompt() */
  guidance?: string;
}

export interface TemplateGroup {
  /** Group name — null means unnamed P2P channel */
  name: string | null;
  /** Member role names: ["human", "coordinator", ...]. "human" is always auto-added. */
  members: string[];
}

export interface WorkspaceTemplate {
  id: string;
  /** Emoji icon for gallery card */
  icon: string;
  /** i18n key for display name */
  nameKey: string;
  /** i18n key for description */
  descKey: string;
  /** Agent definitions — does NOT include "human" (always auto-added) */
  agents: TemplateAgent[];
  /** Group topology — member names resolve to agent IDs at creation time */
  groups: TemplateGroup[];
  /** i18n key for the welcome message sent by the first agent */
  welcomeKey: string;
}

// ── Templates ──────────────────────────────────────────────────────

const templates: WorkspaceTemplate[] = [
  {
    id: "blank",
    icon: "+",
    nameKey: "templates.blank.name",
    descKey: "templates.blank.desc",
    agents: [{ role: "assistant" }],
    groups: [{ name: null, members: ["human", "assistant"] }],
    welcomeKey: "templates.welcome.blank",
  },
  {
    id: "research-team",
    icon: "🔍",
    nameKey: "templates.research-team.name",
    descKey: "templates.research-team.desc",
    agents: [
      {
        role: "coordinator",
        guidance:
          "Coordinate research workflows. Break research requests into investigation, analysis, and writing phases.",
      },
      {
        role: "researcher",
        guidance:
          "Focus on gathering information from available sources. Cite everything. Be thorough and cross-reference.",
      },
      {
        role: "creator",
        guidance:
          "Specialize in turning research findings into clear, well-structured reports and articles.",
      },
    ],
    groups: [
      {
        name: "Research Team",
        members: ["human", "coordinator", "researcher", "creator"],
      },
      { name: null, members: ["human", "coordinator"] },
      { name: null, members: ["human", "researcher"] },
      { name: null, members: ["human", "creator"] },
    ],
    welcomeKey: "templates.welcome.research-team",
  },
  {
    id: "dev-team",
    icon: "💻",
    nameKey: "templates.dev-team.name",
    descKey: "templates.dev-team.desc",
    agents: [
      {
        role: "coordinator",
        guidance:
          "You are the tech lead. Coordinate development sprints, assign coding tasks, review progress, and make architecture decisions.",
      },
      {
        role: "frontend",
        guidance:
          "Frontend developer specializing in React, TypeScript, and modern UI implementation. Write clean, accessible, responsive code.",
      },
      {
        role: "backend",
        guidance:
          "Backend developer specializing in APIs, databases, and server-side logic. Write robust, well-tested code.",
      },
      {
        role: "reviewer",
        guidance:
          "Code reviewer. Focus on correctness, security, performance, and maintainability. Provide constructive, specific feedback.",
      },
      {
        role: "qa",
        guidance:
          "QA engineer. Design test cases, find edge cases, verify requirements compliance. Think like a user.",
      },
    ],
    groups: [
      {
        name: "Dev Team",
        members: [
          "human",
          "coordinator",
          "frontend",
          "backend",
          "reviewer",
          "qa",
        ],
      },
      { name: null, members: ["human", "coordinator"] },
      { name: null, members: ["human", "frontend"] },
      { name: null, members: ["human", "backend"] },
      { name: null, members: ["human", "reviewer"] },
      { name: null, members: ["human", "qa"] },
    ],
    welcomeKey: "templates.welcome.dev-team",
  },
  {
    id: "content-team",
    icon: "✍️",
    nameKey: "templates.content-team.name",
    descKey: "templates.content-team.desc",
    agents: [
      {
        role: "creator",
        guidance:
          "Content writer. Produce drafts, articles, scripts, and copy. Match requested tone and style precisely.",
      },
      {
        role: "editor",
        guidance:
          "Content editor. Refine, polish, and improve existing drafts. Check clarity, grammar, flow, and consistency.",
      },
      {
        role: "specialist",
        guidance:
          "SEO specialist. Optimize content for search engines. Suggest keywords, meta descriptions, headings, and structure improvements.",
      },
    ],
    groups: [
      {
        name: "Content Team",
        members: ["human", "creator", "editor", "specialist"],
      },
      { name: null, members: ["human", "creator"] },
      { name: null, members: ["human", "editor"] },
      { name: null, members: ["human", "specialist"] },
    ],
    welcomeKey: "templates.welcome.content-team",
  },
  {
    id: "product-team",
    icon: "📦",
    nameKey: "templates.product-team.name",
    descKey: "templates.product-team.desc",
    agents: [
      {
        role: "coordinator",
        guidance:
          "Product manager. Define requirements, prioritize features, write user stories, and coordinate the team. Think from the user's perspective.",
      },
      {
        role: "designer",
        guidance:
          "UX/UI designer. Create wireframes, user flows, and design specifications. Focus on usability and accessibility.",
      },
      {
        role: "developer",
        guidance:
          "Full-stack developer. Implement features based on design specs and requirement docs. Write clean, maintainable code.",
      },
      {
        role: "reviewer",
        guidance:
          "QA engineer. Write test plans, find bugs, verify features meet requirements. Ensure quality before release.",
      },
    ],
    groups: [
      {
        name: "Product Team",
        members: ["human", "coordinator", "designer", "developer", "reviewer"],
      },
      { name: null, members: ["human", "coordinator"] },
      { name: null, members: ["human", "designer"] },
      { name: null, members: ["human", "developer"] },
      { name: null, members: ["human", "reviewer"] },
    ],
    welcomeKey: "templates.welcome.product-team",
  },
  {
    id: "support-team",
    icon: "🎧",
    nameKey: "templates.support-team.name",
    descKey: "templates.support-team.desc",
    agents: [
      {
        role: "coordinator",
        guidance:
          "Customer service coordinator. Triage incoming requests, route to appropriate agents, escalate complex issues. Track resolution status.",
      },
      {
        role: "specialist",
        guidance:
          "Customer service agent. Handle general inquiries, FAQ, and common issues. Be empathetic, patient, and solution-oriented.",
      },
      {
        role: "researcher",
        guidance:
          "Knowledge base agent. Maintain FAQ documentation, provide detailed product information, research uncommon questions thoroughly.",
      },
      {
        role: "creator",
        guidance:
          "Escalation handler. Handle complaints, complex issues, and cases requiring human decision-maker involvement. Be diplomatic and professional.",
      },
    ],
    groups: [
      {
        name: "Support Team",
        members: [
          "human",
          "coordinator",
          "specialist",
          "researcher",
          "creator",
        ],
      },
      { name: null, members: ["human", "coordinator"] },
      { name: null, members: ["human", "specialist"] },
      { name: null, members: ["human", "researcher"] },
      { name: null, members: ["human", "creator"] },
    ],
    welcomeKey: "templates.welcome.support-team",
  },
];

// ── Registry ───────────────────────────────────────────────────────

const templateMap = new Map(templates.map((t) => [t.id, t]));

export function listTemplates(): WorkspaceTemplate[] {
  return templates;
}

export function getTemplate(id: string): WorkspaceTemplate | undefined {
  return templateMap.get(id);
}
