export const runtime = 'nodejs';

import { recordSlotExposure } from '@/runtime/activity-slots';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { slotId, sessionId } = body;
    if (!slotId || !sessionId) {
      return Response.json({ error: 'Missing slotId or sessionId' }, { status: 400 });
    }
    await recordSlotExposure(slotId, sessionId);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
