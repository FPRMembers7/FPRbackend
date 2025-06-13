const axios = require("axios");
const https = require("https");

exports.handler = async function (event, context) {
  // Allow preflight OPTIONS request
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

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <DailyItemUpdateDS xmlns="http://webservices.theshootingwarehouse.com/smart/Inventory.asmx">
        <CustomerNumber>99994</CustomerNumber>
        <UserName>99994</UserName>
        <Password>12345</Password>
        <LastUpdate>1/4/2025</LastUpdate>
        <LastItem>-1</LastItem>
        <Source>FPR</Source>
      </DailyItemUpdateDS>
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
          "SOAPAction":
            "http://webservices.theshootingwarehouse.com/smart/Inventory.asmx/DailyItemUpdateDS",
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
