// fetchrefer.js

const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async function (event, context) {
  const referrerId = event.queryStringParameters?.id;

  if (!referrerId) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ error: 'Missing ReferrerID in query parameters' }),
    };
  }

  try {
    const filteredRecords = [];

    await base('Referrals').select({
      view: 'Grid view',
      filterByFormula: `{ReferrerID} = "${referrerId}"`
    }).eachPage((recordsPage, fetchNextPage) => {
      recordsPage.forEach(record => {
        filteredRecords.push(record.fields);
      });
      fetchNextPage();
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({
        count: filteredRecords.length,
        records: filteredRecords
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ error: 'Airtable fetch error', details: error.message }),
    };
  }
};
