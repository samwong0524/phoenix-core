import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

export type SlotId =
  | 'app.header.reward'
  | 'app.campaign.notice'
  | 'chat.input.feature-tip-carousel'
  | 'page.skills.banner'
  | 'page.plugins.banner'
  | 'page.connectors.banner';

export type SlotConfig = {
  id: SlotId;
  title: string;
  content: string;
  actionUrl?: string;
  iframeUrl?: string;
  frequency: 'none' | 'session' | 'remember';
  width?: number;
  height?: number;
  enabled: boolean;
};

const DEFAULT_SLOTS: SlotConfig[] = [
  { id: 'app.header.reward', title: '奖励中心', content: '每日登录获取积分', actionUrl: '/rewards', frequency: 'session', width: 200, height: 40, enabled: true },
  { id: 'app.campaign.notice', title: '活动通知', content: '新功能上线，快来体验！', actionUrl: '/campaigns', frequency: 'remember', width: 300, height: 48, enabled: true },
  { id: 'chat.input.feature-tip-carousel', title: '功能提示', content: '尝试使用 dispatch_pipeline 进行多阶段任务执行', frequency: 'session', enabled: true },
  { id: 'page.skills.banner', title: '技能推荐', content: '探索更多专业技能，提升工作效率', actionUrl: '/skills', frequency: 'none', enabled: true },
  { id: 'page.plugins.banner', title: '插件推荐', content: '安装插件扩展 Agent 能力边界', actionUrl: '/skills', frequency: 'none', enabled: true },
  { id: 'page.connectors.banner', title: '连接器管理', content: '连接微信、飞书、钉钉等 IM 平台', actionUrl: '/settings', frequency: 'none', enabled: true },
];

export async function getSlotConfig(slotId: SlotId): Promise<SlotConfig | null> {
  try {
    const db = getDb();
    const rows = await db.execute(
      sql`SELECT title, content, action_url, iframe_url, frequency, width, height, enabled FROM activity_slots WHERE id = ${slotId} LIMIT 1`
    );
    const arr = rows as unknown as Array<{
      title: string; content: string; action_url: string | null;
      iframe_url: string | null; frequency: string; width: number | null;
      height: number | null; enabled: boolean;
    }>;
    if (arr.length === 0) {
      return DEFAULT_SLOTS.find((s) => s.id === slotId) ?? null;
    }
    const row = arr[0];
    return {
      id: slotId,
      title: row.title,
      content: row.content,
      actionUrl: row.action_url ?? undefined,
      iframeUrl: row.iframe_url ?? undefined,
      frequency: row.frequency as SlotConfig['frequency'],
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      enabled: row.enabled,
    };
  } catch {
    return DEFAULT_SLOTS.find((s) => s.id === slotId) ?? null;
  }
}

export async function getAllSlotConfigs(): Promise<SlotConfig[]> {
  const results: SlotConfig[] = [];
  for (const slotId of DEFAULT_SLOTS.map((s) => s.id)) {
    const config = await getSlotConfig(slotId);
    if (config) results.push(config);
  }
  return results;
}

export async function recordSlotExposure(slotId: SlotId, sessionId: string): Promise<void> {
  try {
    const db = getDb();
    await db.execute(
      sql`INSERT INTO activity_exposures (id, slot_id, session_id, exposed_at)
          VALUES (gen_random_uuid(), ${slotId}, ${sessionId}, now())`
    );
  } catch {
    // best-effort
  }
}

export async function recordSlotClick(slotId: SlotId, sessionId: string, actionUrl?: string): Promise<void> {
  try {
    const db = getDb();
    await db.execute(
      sql`INSERT INTO activity_exposures (id, slot_id, session_id, action_url, clicked_at)
          VALUES (gen_random_uuid(), ${slotId}, ${sessionId}, ${actionUrl ?? ''}, now())`
    );
  } catch {
    // best-effort
  }
}
