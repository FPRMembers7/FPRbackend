// Shared allow-list gate for legacy unauthenticated Airtable-backed endpoints.
// These functions have no session/token auth, so this is a floor, not real auth:
// it blocks anonymous scripts/curl (no Origin/Referer) and off-site pages, but a
// client that forges an Origin header can still pass. See SECURITY_ESCALATION_FETCHORDER.md.
const ALLOWED_ORIGIN_PATTERN = /^https:\/\/([a-z0-9-]+\.)*fprmembers\.com$/i;

function matchOrigin(value) {
  if (!value) return null;
  try {
    const origin = new URL(value).origin;
    return ALLOWED_ORIGIN_PATTERN.test(origin) ? origin : null;
  } catch (e) {
    return null;
  }
}

function resolveAllowedOrigin(event) {
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin;
  const referer = headers.referer || headers.Referer;
  return matchOrigin(origin) || matchOrigin(referer);
}

module.exports = { resolveAllowedOrigin };
