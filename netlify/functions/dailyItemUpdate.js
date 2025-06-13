const axios = require("axios");
const https = require("https");

exports.handler = async function (event, context) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      },
      body: "",
    };
  }

  // Optional: Pull params from frontend (POST body)
  const { lastUpdate = "1/1/1990", lastItem = -1 } = JSON.parse(event.body || "{}");

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <DailyItemUpdate xmlns="http://webservices.theshootingwarehouse.com/smart/Inventory.asmx">
        <CustomerNumber>99994</CustomerNumber>
        <UserName>99994</UserName>
        <Password>12345</Password>
        <LastUpdate>${lastUpdate}</LastUpdate>
        <LastItem>${lastItem}</LastItem>
        <Source>FPR</Source>
      </DailyItemUpdate>
    </soap:Body>
  </soap:Envelope>`;

  try {
    const response = await axios.post(
      "http://webservices.theshootingwarehouse.com/smart/inventory.asmx",
      soapBody,
      {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "http://webservices.theshootingwarehouse.com/smart/Inventory.asmx/DailyItemUpdate",
        },
      }
    );

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: true, xml: response.data }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: false,
        message: "SOAP request failed",
        error: error.message,
      }),
    };
  }
};
