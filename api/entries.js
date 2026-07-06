// Session-gated read/write of the single tracker blob in Vercel KV.
import { kv, KEYS, readJson, send, requireSession } from './_lib.js';

const EMPTY = { accounts: [], done: {}, notes: {}, active: null, seeded: false, sheetUrl: '', dailyGoal: 50, handoffNote: '', extra: {} };

export default async function handler(req, res) {
  if (!requireSession(req)) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET') {
    const data = await kv.get(KEYS.entries);
    return send(res, 200, data || EMPTY);
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    const payload = {
      accounts: Array.isArray(body.accounts) ? body.accounts : [],
      done: body.done && typeof body.done === 'object' ? body.done : {},
      notes: body.notes && typeof body.notes === 'object' ? body.notes : {},
      active: body.active || null,
      seeded: !!body.seeded,
      sheetUrl: typeof body.sheetUrl === 'string' ? body.sheetUrl : '',
      dailyGoal: Number(body.dailyGoal) || 50,
      handoffNote: typeof body.handoffNote === 'string' ? body.handoffNote.slice(0, 2000) : '',
      extra: body.extra && typeof body.extra === 'object' ? body.extra : {},
    };
    await kv.set(KEYS.entries, payload);
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'method not allowed' });
}
