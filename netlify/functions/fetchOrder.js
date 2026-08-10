const Airtable = require('airtable');
const { resolveAllowedOrigin } = require('./lib/allowedOrigin');
const { readBearerToken, verifyMemberToken } = require('./lib/msAuth');

// Injectable for tests — production never sets this global.
function getBase() {
  if (global.__FPR_AIRTABLE_BASE__) return global.__FPR_AIRTABLE_BASE__;
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
}

// Airtable formula string injection guard: MemberID is a verified Memberstack
// id (e.g. "mem_abc123"), never caller-supplied, but this still escapes any
// double-quote defensively since the value flows into a formula string.
function escapeFormulaValue(value) {
  return String(value).replace(/"/g, '\\"');
}

exports.handler = async function (event, context) {
  const allowedOrigin = resolveAllowedOrigin(event);

  if (!allowedOrigin) {
    return {
      statusCode: 403,
      headers: { 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  const token = readBearerToken(event.headers);
  const verified = await verifyMemberToken(token, process.env.MEMBERSTACK_SECRET_KEY);

  if (!verified.ok) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  // Identity comes ONLY from the verified token. Any memberId in the query
  // string (legacy clients sometimes still send one) is ignored.
  const memberId = verified.memberId;

  try {
    let count = 0;

    await getBase()('Orders').select({
      view: 'Grid view',
      filterByFormula: `{MemberID} = "${escapeFormulaValue(memberId)}"`,
    }).eachPage((recordsPage, fetchNextPage) => {
      count += recordsPage.length;
      fetchNextPage();
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ count }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Airtable fetch error', details: error.message }),
    };
  }
};
