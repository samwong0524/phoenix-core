"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { useI18n, LanguageSwitcher } from "@/lib/i18n/context";
import { Card, PageHeader, Alert } from "@/components/ui";
import WorkspacesList from "./workspaces-list";
import TemplateGallery from "./template-gallery";
import { ROUTES, templatesUrl } from "./routes";

type HomePageContentProps = {
  workspaces: Array<{ id: string; name: string; createdAt: string }>;
  dbError?: boolean;
  children?: ReactNode;
};

export default function HomePageContent({ workspaces, dbError, children }: HomePageContentProps) {
  const { t } = useI18n();

  return (
    <div style={{ height: "100vh", overflowY: "auto", padding: "24px 24px 48px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Header */}
        <PageHeader
          title={t("home.title")}
          subtitle={t("home.subtitle")}
          actions={<LanguageSwitcher />}
        />

        {/* DB Error Notice */}
        {dbError && (
          <Alert variant="error" style={{ marginBottom: 16 }}>
            {t("home.db_error")}
          </Alert>
        )}

        {/* System Status */}
        {children}

        {/* Navigation Cards */}
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 12,
          }}
        >
          {t("nav.quick_nav")}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <NavCard href={ROUTES.CHAT} title={t("home.im_title")} desc={t("home.im_desc")} />
          <NavCard href={ROUTES.WORKFLOW} title={t("home.workflow_title")} desc={t("home.workflow_desc")} />
          <NavCard href={ROUTES.HISTORY} title={t("home.history_title")} desc={t("home.history_desc")} />
          <NavCard href={ROUTES.TEMPLATES} title={t("home.templates_title")} desc={t("home.templates_desc")} />
          <NavCard href={ROUTES.GRAPH} title={t("home.graph_title")} desc={t("home.graph_desc")} />
          <NavCard href={ROUTES.SKILLS} title={t("home.skills_title")} desc={t("home.skills_desc")} />
          <NavCard href={ROUTES.MODELS} title={t("home.models_title")} desc={t("home.models_desc")} />
        </div>

        {/* Workspaces */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            {t("home.workspaces")}
          </div>
          <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
            {t("home.workspaces_hint")}
          </p>
          <WorkspacesList workspaces={workspaces} />
        </div>

        {/* Template Gallery */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            {t("templates.title")}
          </div>
          <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
            {t("templates.subtitle")}
          </p>
          <TemplateGallery />
        </div>
      </div>
    </div>
  );
}

function NavCard({ href, title, desc, external }: { href: string; title: string; desc: string; external?: boolean }) {
  return (
    <Link href={href} target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined} style={{ textDecoration: "none", color: "inherit" }}>
      <Card hoverable padding="16px 20px" borderRadius="8px">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{desc}</div>
      </Card>
    </Link>
  );
}
