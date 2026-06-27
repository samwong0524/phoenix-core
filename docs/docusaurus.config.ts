import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "SWARM IDE",
  tagline: "Multi-agent orchestration platform with workflow engine, MCP tools, and self-learning capabilities",

  url: "https://swarm-ide.com",
  baseUrl: "/",

  organizationName: "swarm-ide",
  projectName: "swarm-ide",

  onBrokenLinks: "throw",

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "zh-CN",
    locales: ["zh-CN", "en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/swarm-ide/swarm-ide/edit/main/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: "SWARM IDE",
      logo: {
        alt: "SWARM IDE Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docSidebar",
          position: "left",
          label: "Docs",
        },
        {
          type: "localeDropdown",
          position: "right",
        },
        {
          href: "https://github.com/swarm-ide/swarm-ide",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Introduction", to: "/docs/intro" },
            { label: "Architecture", to: "/docs/architecture/overview" },
            { label: "API Reference", to: "/docs/api/overview" },
          ],
        },
        {
          title: "More",
          items: [
            { label: "GitHub", href: "https://github.com/swarm-ide/swarm-ide" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} SWARM IDE. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["typescript", "bash", "json", "sql"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
