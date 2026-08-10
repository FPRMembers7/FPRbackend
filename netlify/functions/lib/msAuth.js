// Memberstack token verification for the legacy Airtable functions
// (fetchOrder, fetchrefer). Ported from fpr-backend/netlify/functions/lib/auth.js
// so both backends verify identity the same way, against the same provider.
//
// Injectable via global.__FPR_MS_VERIFY__ for tests — never hits the network
// in a test run, and production never has that global set.
var VERIFY_URL = "https://admin.memberstack.com/members/verify-token";

function readBearerToken(headers) {
  if (!headers) return null;
  var raw = headers.authorization || headers.Authorization || headers.AUTHORIZATION;
  if (!raw || typeof raw !== "string") return null;
  var match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  var token = match[1].trim();
  return token.length ? token : null;
}

// Returns { ok:true, memberId } or { ok:false, reason }. Never throws.
async function verifyMemberToken(token, memberstackApiKey) {
  if (global.__FPR_MS_VERIFY__) return global.__FPR_MS_VERIFY__(token, memberstackApiKey);

  if (!token) return { ok: false, reason: "TOKEN_MISSING" };
  if (!memberstackApiKey) return { ok: false, reason: "SERVER_MISCONFIGURED" };

  var res;
  try {
    res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "X-API-KEY": memberstackApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ token: token })
    });
  } catch (err) {
    return { ok: false, reason: "VERIFY_UNAVAILABLE" };
  }

  var payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }

  if (!res || !res.ok) {
    return { ok: false, reason: (payload && payload.code) || "INVALID_TOKEN" };
  }

  var data = payload && payload.data;
  if (!data || !data.id) return { ok: false, reason: "INVALID_TOKEN" };
  if (data.type && data.type !== "member") return { ok: false, reason: "WRONG_TOKEN_TYPE" };

  return { ok: true, memberId: data.id };
}

module.exports = { readBearerToken: readBearerToken, verifyMemberToken: verifyMemberToken };
