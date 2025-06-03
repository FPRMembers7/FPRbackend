const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async function (event, context) {
  try {
    const records = [];

    await base('Orders').select({
      maxRecords: 10,
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
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify(records),
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
