// Activation, the server-side sliver. The rulebook itself (states, the
// event → proposal table, the writer's engagement line) lives in index.html
// inside /* @export:activation */ … /* @end */, where the page uses it and
// test/activation.test.js extracts it. The server only needs to count what
// Resend reports.

// Record an engagement event from the webhook on a queue entry. Opens and
// clicks are counted, not stored one by one; the page copies the counts into
// the contact's event log on its next load.
export function noteEngagement(entry, type, at) {
  if (!entry) return entry;
  const ts = at || new Date().toISOString();
  if (type === 'email.opened') { entry.opens = (entry.opens || 0) + 1; entry.lastOpenAt = ts; if (!entry.firstOpenAt) entry.firstOpenAt = ts; }
  if (type === 'email.clicked') { entry.clicks = (entry.clicks || 0) + 1; entry.lastClickAt = ts; if (!entry.firstClickAt) entry.firstClickAt = ts; }
  return entry;
}
