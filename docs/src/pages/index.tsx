import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className="hero hero--primary" style={{ textAlign: "center", padding: "4rem 0" }}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", marginTop: "2rem" }}>
          <Link className="button button--secondary button--lg" to="/docs/intro">
            Get Started →
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/architecture/overview">
            Architecture
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): JSX.Element {
  return (
    <Layout description="SWARM IDE — Multi-agent orchestration platform documentation">
      <HomepageHeader />
      <main style={{ padding: "3rem 0" }}>
        <div className="container">
          <div className="row">
            <div className="col col--4" style={{ padding: "1rem" }}>
              <div className="card" style={{ padding: "1.5rem", height: "100%" }}>
                <div className="card__body">
                  <Heading as="h3">Multi-Agent System</Heading>
                  <p>Orchestrate multiple AI agents in persistent chat groups with role-based access, real-time messaging, and collaborative workflows.</p>
                </div>
              </div>
            </div>
            <div className="col col--4" style={{ padding: "1rem" }}>
              <div className="card" style={{ padding: "1.5rem", height: "100%" }}>
                <div className="card__body">
                  <Heading as="h3">Workflow Engine</Heading>
                  <p>Define and execute DAG-based workflows with task dependencies, approval gates, and automatic retry. Supports human-in-the-loop review.</p>
                </div>
              </div>
            </div>
            <div className="col col--4" style={{ padding: "1rem" }}>
              <div className="card" style={{ padding: "1.5rem", height: "100%" }}>
                <div className="card__body">
                  <Heading as="h3">MCP Integration</Heading>
                  <p>Extend agent capabilities through the Model Context Protocol — connect to any MCP server for tools, resources, and context sharing.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </Layout>
  );
}
