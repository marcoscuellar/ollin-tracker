// Session-gated proxy that fetches a public Google Sheet as CSV.
// Avoids browser CORS and keeps the request server-side. SSRF-guarded to
// Google hosts only.
import { send, requireSession } from './_lib.js';

const ALLOWED = ['docs.google.com', 'www.googleapis.com', 'sheets.googleapis.com'];

export default async function handler(req, res) {
  // Sign-in temporarily disabled — session gate off.
  // if (!requireSession(req)) return send(res, 401, { error: 'unauthorized' });

  const url = (req.query && req.query.url) || '';
  let parsed;
  try { parsed = new URL(url); } catch { return send(res, 400, { error: 'Invalid sheet URL' }); }
  if (!ALLOWED.includes(parsed.hostname)) {
    return send(res, 400, { error: 'Only Google Sheets links are allowed' });
  }

  try {
    const r = await fetch(parsed.toString(), { redirect: 'follow', headers: { 'User-Agent': 'ollin-tracker' } });
    if (!r.ok) {
      return send(res, 400, { error: 'Could not fetch the sheet (' + r.status + '). Make sure link sharing is on (Anyone with the link → Viewer).' });
    }
    const text = await r.text();
    // If Google returns an HTML login/permission page instead of CSV, the sheet isn't public.
    if (/^\s*<(?:!doctype|html)/i.test(text)) {
      return send(res, 400, { error: 'That sheet is not public. In Google Sheets: Share → General access → Anyone with the link → Viewer.' });
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(text);
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
