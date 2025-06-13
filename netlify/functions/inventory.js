const axios = require("axios");
const https = require("https");
const { parseStringPromise } = require("xml2js");

// 🛡️ Bypass SSL error from ShootingWarehouse
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

  const INVENTORY_URL = "https://webservices.theshootingwarehouse.com/smart/inventory.asmx/OnhandUpdateDS";
  const PRODUCT_URL = "https://webservices.theshootingwarehouse.com/smart/inventory.asmx/DailyItemUpdateDS";

  try {
    // 🔄 Fetch Inventory
    const inventoryRes = await axios.get(INVENTORY_URL, {
      params: {
        CustomerNumber: SW_CUST_NO,
        UserName: SW_USER,
        Password: SW_PASS,
        Source: SW_SOURCE,
      },
      httpsAgent: agent,
    });

    const inventoryXML = await parseStringPromise(inventoryRes.data);
    const inventoryList = inventoryXML?.DataSet?.NewDataSet?.Table || [];
    const inventoryMap = {};
    inventoryList.forEach((item) => {
      inventoryMap[item.I[0]] = {
        quantity: item.Q?.[0] || 0,
        catalogPrice: item.P?.[0] || null,
        customerPrice: item.C?.[0] || null,
      };
    });

    // 🧾 Fetch Product Data (Paginated)
    const productRes = await axios.post(PRODUCT_URL, new URLSearchParams({
      CustomerNumber: SW_CUST_NO,
      UserName: SW_USER,
      Password: SW_PASS,
      LastUpdate: "1/1/1990",
      LastItem: offset.toString(),
      Source: SW_SOURCE,
    }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      httpsAgent: agent,
    });

    const productXML = await parseStringPromise(productRes.data);
    const productList = productXML?.DataSet?.NewDataSet?.Table || [];

    // 🔗 Merge product + inventory
    const products = productList.map((item) => {
      const id = item.ITEMNO?.[0];
      const inventory = inventoryMap[id] || {};
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
        inventory: {
          quantity: inventory.quantity || 0,
          catalogPrice: inventory.catalogPrice,
          customerPrice: inventory.customerPrice,
        },
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        page,
        limit,
        count: products.length,
        products,
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
