-- Phase 1: Pipeline executions table
CREATE TABLE IF NOT EXISTS pipeline_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL,
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  group_id UUID NOT NULL REFERENCES groups(id),
  stage_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  output TEXT,
  agent_id UUID REFERENCES agents(id),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  error TEXT
);
CREATE INDEX IF NOT EXISTS pipeline_exec_pipeline_idx ON pipeline_executions(pipeline_id);
CREATE INDEX IF NOT EXISTS pipeline_exec_workflow_idx ON pipeline_executions(workflow_id);

-- Phase 4: Activity slots and exposures
CREATE TABLE IF NOT EXISTS activity_slots (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  action_url TEXT,
  iframe_url TEXT,
  frequency TEXT NOT NULL DEFAULT 'none',
  width INTEGER,
  height INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_exposures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id TEXT NOT NULL REFERENCES activity_slots(id),
  session_id TEXT NOT NULL,
  action_url TEXT,
  exposed_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS activity_exp_slot_idx ON activity_exposures(slot_id);
CREATE INDEX IF NOT EXISTS activity_exp_session_idx ON activity_exposures(session_id);

-- Insert default activity slots
INSERT INTO activity_slots (id, title, content, action_url, frequency, width, height, enabled)
VALUES
  ('app.header.reward', '\u5956\u52B1\u4E2D\u5FC3', '\u6BCF\u65E5\u767B\u5F55\u83B7\u53D6\u79EF\u5206', '/rewards', 'session', 200, 40, true),
  ('app.campaign.notice', '\u6D3B\u52A8\u901A\u77E5', '\u65B0\u529F\u80FD\u4E0A\u7EBF\uFF0C\u5FEB\u6765\u4F53\u9A8C\uFF01', '/campaigns', 'remember', 300, 48, true),
  ('chat.input.feature-tip-carousel', '\u529F\u80FD\u63D0\u793A', '\u5C1D\u8BD5\u4F7F\u7528 dispatch_pipeline \u8FDB\u884C\u591A\u9636\u6BB5\u4EFB\u52A1\u6267\u884C', NULL, 'session', NULL, NULL, true),
  ('page.skills.banner', '\u6280\u80FD\u63A8\u8350', '\u63A2\u7D22\u66F4\u591A\u4E13\u4E1A\u6280\u80FD', '/skills', 'none', NULL, NULL, true),
  ('page.plugins.banner', '\u63D2\u4EF6\u63A8\u8350', '\u5B89\u88C5\u63D2\u4EF6\u6269\u5C55 Agent \u80FD\u529B', '/skills', 'none', NULL, NULL, true),
  ('page.connectors.banner', '\u8FDE\u63A5\u5668\u7BA1\u7406', '\u8FDE\u63A5\u5FAE\u4FE1\u3001\u98DE\u4E66\u3001\u9489\u9489', '/settings', 'none', NULL, NULL, true)
ON CONFLICT (id) DO NOTHING;
