const axios = require("axios");
const https = require("https");
const { parseStringPromise } = require("xml2js");

const agent = new https.Agent({ rejectUnauthorized: false });

exports.handler = async function () {
  const {
    SW_USER,
    SW_PASS,
    SW_CUST_NO,
    SW_SOURCE,
  } = process.env;

  try {
    const res = await axios.get(
      "https://webservices.theshootingwarehouse.com/smart/inventory.asmx/OnhandUpdateDS",
      {
        params: {
          CustomerNumber: SW_CUST_NO,
          UserName: SW_USER,
          Password: SW_PASS,
          Source: SW_SOURCE,
        },
        httpsAgent: agent,
      }
    );

    const json = await parseStringPromise(res.data);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, parsed: json }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Inventory test failed", details: err.message }),
    };
  }
};
