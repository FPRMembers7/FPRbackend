// fetchrefer.js

const Airtable = require('airtable');
const { resolveAllowedOrigin } = require('./lib/allowedOrigin');
const { readBearerToken, verifyMemberToken } = require('./lib/msAuth');

function getBase() {
  if (global.__FPR_AIRTABLE_BASE__) return global.__FPR_AIRTABLE_BASE__;
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
}

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

  // Identity comes ONLY from the verified token. A caller-supplied ?id= is
  // never consulted — a member can only ever see their own referral count.
  const referrerId = verified.memberId;

  try {
    let count = 0;

    await getBase()('Referrals').select({
      view: 'Grid view',
      filterByFormula: `{ReferrerID} = "${escapeFormulaValue(referrerId)}"`,
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
