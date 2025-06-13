const axios = require("axios");
const { parseStringPromise } = require("xml2js");

const INVENTORY_URL = "https://webservices.theshootingwarehouse.com/smart/inventory.asmx/OnhandUpdateDS";
const PRODUCT_URL = "https://webservices.theshootingwarehouse.com/smart/inventory.asmx/DailyItemUpdateDS";

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
    // Step 1: Fetch Inventory (once)
    const inventoryRes = await axios.get(INVENTORY_URL, {
      params: {
        CustomerNumber: SW_CUST_NO,
        UserName: SW_USER,
        Password: SW_PASS,
        Source: SW_SOURCE,
      },
    });

    const inventoryXML = await parseStringPromise(inventoryRes.data);
    const inventoryItems = inventoryXML?.["DataSet"]?.["NewDataSet"]?.["Table"] || [];

    const inventoryMap = {};
    inventoryItems.forEach((item) => {
      inventoryMap[item.I[0]] = {
        itemNumber: item.I[0],
        quantity: item.Q[0],
        catalogPrice: item.P[0],
        customerPrice: item.C[0],
      };
    });

    // Step 2: Fetch Product Chunk (paged)
    const productRes = await axios.post(PRODUCT_URL, new URLSearchParams({
      CustomerNumber: SW_CUST_NO,
      UserName: SW_USER,
      Password: SW_PASS,
      LastUpdate: "1/1/1990",
      LastItem: offset.toString(),
      Source: SW_SOURCE,
    }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const productXML = await parseStringPromise(productRes.data);
    const productItems = productXML?.["DataSet"]?.["NewDataSet"]?.["Table"] || [];

    // Step 3: Merge & map response
    const results = productItems.map((item) => {
      const id = item.ITEMNO?.[0];
      return {
        itemNumber: id,
        name: item.IDESC?.[0] || "",
        shortDescription: item.SHDESC?.[0] || "",
        model: item.IMODEL?.[0] || "",
        upc: item.ITUPC?.[0] || "",
        categoryId: item.CATID?.[0] || "",
        attributes: {
          caliber: item.ITATR2?.[0] || "",
          capacity: item.ITATR4?.[0] || "",
          weight: item.ITATR9?.[0] || "",
          barrelLength: item.ITATR3?.[0] || "",
        },
        inventory: inventoryMap[id] || {
          quantity: 0,
          catalogPrice: null,
          customerPrice: null,
        },
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        page,
        limit,
        count: results.length,
        products: results,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch inventory/products", details: err.message }),
    };
  }
};
