// Read/write the tracker blob for the logged-in user (entries:<userId>).
import { kv, readJson, send, requireSession, entriesKey } from './_lib.js';

const EMPTY = { accounts: [], done: {}, notes: {}, reschedule: {}, todos: [], active: null, seeded: false, sheetUrl: '', dailyGoal: 50, handoffNote: '', extra: {}, coldStreakSince: null, updatedAt: null };

export default async function handler(req, res) {
  const s = requireSession(req);
  if (!s || !s.sub) return send(res, 401, { error: 'unauthorized' });
  const key = entriesKey(s.sub);

  if (req.method === 'GET') {
    const data = await kv.get(key);
    return send(res, 200, data || EMPTY);
  }

  if (req.method === 'POST') {
    const body = await readJson(req);

    /*
      An empty accounts array arriving over a non-empty stored one is almost
      never a real wipe — it is a client that failed to load and is now writing
      its blank initializer back. That is how a pipeline disappears. The one
      legitimate wipe (doClear) says so explicitly.
    */
    if (!Array.isArray(body.accounts) || body.accounts.length === 0) {
      if (!body.allowEmpty) {
        const stored = await kv.get(key);
        if (stored && Array.isArray(stored.accounts) && stored.accounts.length) {
          return send(res, 409, { error: 'refused: empty payload over existing data', accounts: stored.accounts.length });
        }
      }
    }

    const payload = {
      accounts: Array.isArray(body.accounts) ? body.accounts : [],
      done: body.done && typeof body.done === 'object' ? body.done : {},
      notes: body.notes && typeof body.notes === 'object' ? body.notes : {},
      reschedule: body.reschedule && typeof body.reschedule === 'object' ? body.reschedule : {},
      todos: Array.isArray(body.todos) ? body.todos : [],
      active: body.active || null,
      seeded: !!body.seeded,
      sheetUrl: typeof body.sheetUrl === 'string' ? body.sheetUrl : '',
      dailyGoal: Number(body.dailyGoal) || 50,
      handoffNote: typeof body.handoffNote === 'string' ? body.handoffNote.slice(0, 2000) : '',
      extra: body.extra && typeof body.extra === 'object' ? body.extra : {},
      coldStreakSince: typeof body.coldStreakSince === 'string' ? body.coldStreakSince : null,
      updatedAt: new Date().toISOString(),
    };
    await kv.set(key, payload);
    return send(res, 200, { ok: true, updatedAt: payload.updatedAt });
  }

  return send(res, 405, { error: 'method not allowed' });
}
