const Airtable = require('airtable');
const { resolveAllowedOrigin } = require('./lib/allowedOrigin');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async function (event, context) {
  const allowedOrigin = resolveAllowedOrigin(event);

  if (!allowedOrigin) {
    return {
      statusCode: 403,
      headers: {
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  try {
    const records = [];

    await base('Orders').select({

      view: 'Grid view'
    }).eachPage((recordsPage, fetchNextPage) => {
      recordsPage.forEach(record => {
        records.push(record.fields);
      });
      fetchNextPage();
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify(records),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ error: 'Airtable fetch error', details: error.message }),
    };
  }
};
