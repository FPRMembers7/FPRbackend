const axios = require("axios");
const https = require("https");
const { parseStringPromise } = require("xml2js");

// 🛡️ Ignore invalid SSL certs
const agent = new https.Agent({ rejectUnauthorized: false });

exports.handler = async function (event) {
  const {
    SW_USER,
    SW_PASS,
    SW_CUST_NO,
    SW_SOURCE,
  } = process.env;

  const page = parseInt(event.queryStringParameters.page || "1");
  const limit = parseInt(event.queryStringParameters.limit || "20");
  const offset = (page - 1) * limit;

  try {
    // 1️⃣ Fetch INVENTORY data
    const inventoryRes = await axios.post(
      "https://webservices.theshootingwarehouse.com/smart/inventory.asmx/OnhandUpdateDS",
      new URLSearchParams({
        CustomerNumber: SW_CUST_NO,
        UserName: SW_USER,
        Password: SW_PASS,
        Source: SW_SOURCE,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        httpsAgent: agent,
      }
    );

    const inventoryXML = await parseStringPromise(inventoryRes.data);
    const inventoryList = inventoryXML?.DataSet?.NewDataSet?.Table || [];

    const inventoryMap = {};
    inventoryList.forEach((item) => {
      inventoryMap[item.I[0]] = {
        quantity: item.Q?.[0] || "0",
        catalogPrice: item.P?.[0] || null,
        customerPrice: item.C?.[0] || null,
      };
    });

    // 2️⃣ Fetch PRODUCT METADATA (SOAP raw request)
    const soapEnvelope = `
      <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                     xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                     xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <DailyItemUpdateDS xmlns="http://webservices.theshootingwarehouse.com/smart/Inventory.asmx">
            <CustomerNumber>${SW_CUST_NO}</CustomerNumber>
            <UserName>${SW_USER}</UserName>
            <Password>${SW_PASS}</Password>
            <LastUpdate>1/1/1990</LastUpdate>
            <LastItem>${offset}</LastItem>
            <Source>${SW_SOURCE}</Source>
          </DailyItemUpdateDS>
        </soap:Body>
      </soap:Envelope>
    `;

    const productRes = await axios.post(
      "https://webservices.theshootingwarehouse.com/smart/inventory.asmx",
      soapEnvelope,
      {
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "http://webservices.theshootingwarehouse.com/smart/Inventory.asmx/DailyItemUpdateDS",
        },
        httpsAgent: agent,
      }
    );

    const productXML = await parseStringPromise(productRes.data);
    const productList =
      productXML?.["soap:Envelope"]?.["soap:Body"]?.[0]?.["DailyItemUpdateDSResponse"]?.[0]?.["DailyItemUpdateDSResult"]?.[0]?.["diffgr:diffgram"]?.[0]?.["NewDataSet"]?.[0]?.["Table"] || [];

    // 3️⃣ Merge and respond
    const merged = productList.map((item) => {
      const id = item.ITEMNO?.[0];
      const inv = inventoryMap[id] || {};

      return {
        itemNumber: id,
        name: item.IDESC?.[0] || "",
        shortDescription: item.SHDESC?.[0] || "",
        model: item.IMODEL?.[0] || "",
        upc: item.ITUPC?.[0] || "",
        categoryId: item.CATID?.[0] || "",
        attributes: {
          caliber: item.ITATR2?.[0] || "",
          barrelLength: item.ITATR3?.[0] || "",
          capacity: item.ITATR4?.[0] || "",
          weight: item.ITATR9?.[0] || "",
        },
        inventory: {
          quantity: inv.quantity || "0",
          catalogPrice: inv.catalogPrice || null,
          customerPrice: inv.customerPrice || null,
        },
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        page,
        limit,
        count: merged.length,
        products: merged,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to fetch inventory/products",
        details: error.message,
      }),
    };
  }
};
