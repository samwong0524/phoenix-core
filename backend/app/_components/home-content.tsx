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
    <div className="h-screen overflow-y-auto px-6 pt-6 pb-12">
      <div className="max-w-[960px] mx-auto">
        {/* Header */}
        <PageHeader
          title={t("home.title")}
          subtitle={t("home.subtitle")}
          actions={<LanguageSwitcher />}
        />

        {/* DB Error Notice */}
        {dbError && (
          <Alert variant="error" className="mb-4">
            {t("home.db_error")}
          </Alert>
        )}

        {/* System Status */}
        {children}

        {/* Navigation Cards */}
        <div className="text-xs font-semibold text-text-secondary mb-3">
          {t("nav.quick_nav")}
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 mb-6">
          <NavCard href={ROUTES.CHAT} title={t("home.im_title")} desc={t("home.im_desc")} />
          <NavCard href={ROUTES.WORKFLOW} title={t("home.workflow_title")} desc={t("home.workflow_desc")} />
          <NavCard href={ROUTES.HISTORY} title={t("home.history_title")} desc={t("home.history_desc")} />
          <NavCard href={ROUTES.TEMPLATES} title={t("home.templates_title")} desc={t("home.templates_desc")} />
          <NavCard href={ROUTES.GRAPH} title={t("home.graph_title")} desc={t("home.graph_desc")} />
          <NavCard href={ROUTES.SKILLS} title={t("home.skills_title")} desc={t("home.skills_desc")} />
          <NavCard href={ROUTES.MODELS} title={t("home.models_title")} desc={t("home.models_desc")} />
        </div>

        {/* Workspaces */}
        <div className="mb-6">
          <div className="text-[13px] font-bold mb-2">
            {t("home.workspaces")}
          </div>
          <p className="muted mt-0 mb-3 text-[13px]">
            {t("home.workspaces_hint")}
          </p>
          <WorkspacesList workspaces={workspaces} />
        </div>

        {/* Template Gallery */}
        <div className="mb-6">
          <div className="text-[13px] font-bold mb-1">
            {t("templates.title")}
          </div>
          <p className="muted mt-0 mb-3 text-xs">
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
    <Link href={href} target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined} className="no-underline text-inherit block">
      <Card hoverable padding="16px 20px" borderRadius="8px">
        <div className="font-bold text-sm mb-1">{title}</div>
        <div className="muted text-xs leading-[1.4]">{desc}</div>
      </Card>
    </Link>
  );
}
