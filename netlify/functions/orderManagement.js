const axios = require("axios")
const https = require("https")

exports.handler = async (event, context) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      },
      body: "",
    }
  }

  try {
    const { action, orderData, items, orderNumber, startDate, endDate } = JSON.parse(event.body || "{}")

    const credentials = {
      customerNumber: "99994",
      userName: "99994",
      password: "12345",
      source: "FPR",
    }

    switch (action) {
      case "placeOrder":
        return await placeOrder(orderData, items, credentials)
      case "getOrders":
        return await getOrders(credentials, startDate, endDate)
      case "getOrderDetails":
        return await getOrderDetails(orderNumber, credentials)
      case "getTracking":
        return await getTracking(orderNumber, credentials)
      case "getInvoices":
        return await getInvoices(credentials, startDate, endDate)
      default:
        throw new Error("Invalid action specified")
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: false,
        message: "Order operation failed",
        error: error.message,
      }),
    }
  }
}

// Place Order Function
async function placeOrder(orderData, items, credentials) {
  try {
    // Step 1: Add Header
    const headerResult = await addOrderHeader(orderData, credentials)
    if (!headerResult.success || !headerResult.orderNumber) {
      throw new Error("Failed to create order header")
    }

    const orderNumber = headerResult.orderNumber

    // Step 2: Add Details for each item
    for (const item of items) {
      const detailResult = await addOrderDetail(orderNumber, item, credentials)
      if (!detailResult.success) {
        // If detail fails, try to delete the order
        await deleteOrder(orderNumber, credentials)
        throw new Error(`Failed to add item ${item.ITEMNO} to order`)
      }
    }

    // Step 3: Submit Order
    const submitResult = await submitOrder(orderNumber, credentials)
    if (!submitResult.success) {
      // If submit fails, try to delete the order
      await deleteOrder(orderNumber, credentials)
      throw new Error("Failed to submit order")
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        orderNumber: orderNumber,
        message: "Order placed successfully",
      }),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: false,
        message: error.message,
      }),
    }
  }
}

// Add Order Header
async function addOrderHeader(orderData, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.  {
  const soapBody = \`<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <AddHeader xmlns="http://webservices.theshootingwarehouse.com/smart/orders.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <PONumber>${orderData.poNumber}</PONumber>
        <ShipMethod>${orderData.shippingMethod}</ShipMethod>
        <ShipName>${orderData.shipName}</ShipName>
        <ShipCompany>${orderData.shipCompany || ""}</ShipCompany>
        <ShipAddress>${orderData.shipAddress}</ShipAddress>
        <ShipCity>${orderData.shipCity}</ShipCity>
        <ShipState>${orderData.shipState}</ShipState>
        <ShipZip>${orderData.shipZip}</ShipZip>
        <Source>${credentials.source}</Source>
      </AddHeader>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/orders.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/orders.asmx/AddHeader",
      },
    })

    const parser = require("xml2js").parseString
    let orderNumber = null

    parser(response.data, (err, result) => {
      if (!err && result) {
        const addHeaderResult = result["soap:Envelope"]["soap:Body"][0]["AddHeaderResponse"][0]["AddHeaderResult"][0]
        orderNumber = Number.parseInt(addHeaderResult)
      }
    })

    return {
      success: orderNumber && orderNumber > 0,
      orderNumber: orderNumber,
    }
  } catch (error) {
    console.error("AddHeader error:", error)
    return { success: false, error: error.message }
  }
}

// Add Order Detail
async function addOrderDetail(orderNumber, item, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <AddDetail xmlns="http://webservices.theshootingwarehouse.com/smart/orders.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <OrderNumber>${orderNumber}</OrderNumber>
        <ItemNumber>${item.ITEMNO}</ItemNumber>
        <Quantity>${item.quantity}</Quantity>
        <Source>${credentials.source}</Source>
      </AddDetail>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/orders.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/orders.asmx/AddDetail",
      },
    })

    const parser = require("xml2js").parseString
    let success = false

    parser(response.data, (err, result) => {
      if (!err && result) {
        const addDetailResult = result["soap:Envelope"]["soap:Body"][0]["AddDetailResponse"][0]["AddDetailResult"][0]
        success = Number.parseInt(addDetailResult) === 1
      }
    })

    return { success }
  } catch (error) {
    console.error("AddDetail error:", error)
    return { success: false, error: error.message }
  }
}

// Submit Order
async function submitOrder(orderNumber, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <Submit xmlns="http://webservices.theshootingwarehouse.com/smart/orders.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <OrderNumber>${orderNumber}</OrderNumber>
        <Source>${credentials.source}</Source>
      </Submit>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/orders.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/orders.asmx/Submit",
      },
    })

    const parser = require("xml2js").parseString
    let success = false

    parser(response.data, (err, result) => {
      if (!err && result) {
        const submitResult = result["soap:Envelope"]["soap:Body"][0]["SubmitResponse"][0]["SubmitResult"][0]
        success = submitResult.toLowerCase() === "true"
      }
    })

    return { success }
  } catch (error) {
    console.error("Submit error:", error)
    return { success: false, error: error.message }
  }
}

// Delete Order (cleanup function)
async function deleteOrder(orderNumber, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <DeleteOpenOrder xmlns="http://webservices.theshootingwarehouse.com/smart/orders.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <OrderNumber>${orderNumber}</OrderNumber>
        <Source>${credentials.source}</Source>
      </DeleteOpenOrder>
    </soap:Body>
  </soap:Envelope>`

  try {
    await axios.post("http://webservices.theshootingwarehouse.com/smart/orders.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/orders.asmx/DeleteOpenOrder",
      },
    })
  } catch (error) {
    console.error("DeleteOrder error:", error)
  }
}

// Get Orders
async function getOrders(credentials, startDate, endDate) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <GetHeadersDS xmlns="http://webservices.theshootingwarehouse.com/smart/orders.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <Source>${credentials.source}</Source>
      </GetHeadersDS>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/orders.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/orders.asmx/GetHeadersDS",
      },
    })

    const orders = extractOrdersFromXml(response.data)

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        orders: orders,
      }),
    }
  } catch (error) {
    throw new Error(`Failed to get orders: ${error.message}`)
  }
}

// Get Order Details
async function getOrderDetails(orderNumber, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <GetDetailDS xmlns="http://webservices.theshootingwarehouse.com/smart/orders.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <OrderNumber>${orderNumber}</OrderNumber>
        <Source>${credentials.source}</Source>
      </GetDetailDS>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/orders.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/orders.asmx/GetDetailDS",
      },
    })

    const details = extractOrderDetailsFromXml(response.data)

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        details: details,
      }),
    }
  } catch (error) {
    throw new Error(`Failed to get order details: ${error.message}`)
  }
}

// Get Tracking
async function getTracking(orderNumber, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <GetTrackingByOrderNumberDS xmlns="http://webservices.theshootingwarehouse.com/smart/invoices.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <OrderNumber>${orderNumber}</OrderNumber>
        <Source>${credentials.source}</Source>
      </GetTrackingByOrderNumberDS>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/invoices.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/invoices.asmx/GetTrackingByOrderNumberDS",
      },
    })

    const tracking = extractTrackingFromXml(response.data)

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        tracking: tracking,
      }),
    }
  } catch (error) {
    throw new Error(`Failed to get tracking: ${error.message}`)
  }
}

// Get Invoices
async function getInvoices(credentials, startDate, endDate) {
  const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] // 30 days ago
  const end = endDate || new Date().toISOString().split("T")[0] // today

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <GetByDateDS xmlns="http://webservices.theshootingwarehouse.com/smart/invoices.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <StartDate>${start}</StartDate>
        <EndDate>${end}</EndDate>
        <Source>${credentials.source}</Source>
      </GetByDateDS>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/invoices.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/invoices.asmx/GetByDateDS",
      },
    })

    const invoices = extractInvoicesFromXml(response.data)

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        invoices: invoices,
      }),
    }
  } catch (error) {
    throw new Error(`Failed to get invoices: ${error.message}`)
  }
}

// Helper functions to extract data from XML
function extractOrdersFromXml(xmlString) {
  try {
    const parser = require("xml2js").parseString
    let orders = []

    parser(xmlString, (err, result) => {
      if (!err && result) {
        const dataset = result["soap:Envelope"]["soap:Body"][0]["GetHeadersDSResponse"][0]["GetHeadersDSResult"][0]
        if (
          dataset &&
          dataset.diffgr &&
          dataset.diffgr[0] &&
          dataset.diffgr[0].diffgram &&
          dataset.diffgr[0].diffgram[0].NewDataSet
        ) {
          const tables = dataset.diffgr[0].diffgram[0].NewDataSet[0].Table || []
          orders = tables.map((table) => ({
            orderNumber: table.OrderNumber ? table.OrderNumber[0] : "",
            poNumber: table.PONumber ? table.PONumber[0] : "",
            date: table.OrderDate ? table.OrderDate[0] : "",
            status: table.Status ? table.Status[0] : "Unknown",
            total: table.Total ? Number.parseFloat(table.Total[0]) : 0,
          }))
        }
      }
    })

    return orders
  } catch (error) {
    console.error("Error extracting orders from XML:", error)
    return []
  }
}

function extractOrderDetailsFromXml(xmlString) {
  try {
    const parser = require("xml2js").parseString
    let details = []

    parser(xmlString, (err, result) => {
      if (!err && result) {
        const dataset = result["soap:Envelope"]["soap:Body"][0]["GetDetailDSResponse"][0]["GetDetailDSResult"][0]
        if (
          dataset &&
          dataset.diffgr &&
          dataset.diffgr[0] &&
          dataset.diffgr[0].diffgram &&
          dataset.diffgr[0].diffgram[0].NewDataSet
        ) {
          const tables = dataset.diffgr[0].diffgram[0].NewDataSet[0].Table || []
          details = tables.map((table) => ({
            itemNumber: table.ItemNumber ? table.ItemNumber[0] : "",
            description: table.Description ? table.Description[0] : "",
            quantity: table.Quantity ? Number.parseInt(table.Quantity[0]) : 0,
            price: table.Price ? Number.parseFloat(table.Price[0]) : 0,
          }))
        }
      }
    })

    return details
  } catch (error) {
    console.error("Error extracting order details from XML:", error)
    return []
  }
}

function extractTrackingFromXml(xmlString) {
  try {
    const parser = require("xml2js").parseString
    let tracking = []

    parser(xmlString, (err, result) => {
      if (!err && result) {
        const dataset =
          result["soap:Envelope"]["soap:Body"][0]["GetTrackingByOrderNumberDSResponse"][0][
            "GetTrackingByOrderNumberDSResult"
          ][0]
        if (
          dataset &&
          dataset.diffgr &&
          dataset.diffgr[0] &&
          dataset.diffgr[0].diffgram &&
          dataset.diffgr[0].diffgram[0].NewDataSet
        ) {
          const tables = dataset.diffgr[0].diffgram[0].NewDataSet[0].Table || []
          tracking = tables.map((table) => ({
            trackingNumber: table.TrackingNumber ? table.TrackingNumber[0] : "",
            carrier: table.Carrier ? table.Carrier[0] : "",
            service: table.Service ? table.Service[0] : "",
          }))
        }
      }
    })

    return tracking
  } catch (error) {
    console.error("Error extracting tracking from XML:", error)
    return []
  }
}

function extractInvoicesFromXml(xmlString) {
  try {
    const parser = require("xml2js").parseString
    let invoices = []

    parser(xmlString, (err, result) => {
      if (!err && result) {
        const dataset = result["soap:Envelope"]["soap:Body"][0]["GetByDateDSResponse"][0]["GetByDateDSResult"][0]
        if (
          dataset &&
          dataset.diffgr &&
          dataset.diffgr[0] &&
          dataset.diffgr[0].diffgram &&
          dataset.diffgr[0].diffgram[0].NewDataSet
        ) {
          const tables = dataset.diffgr[0].diffgram[0].NewDataSet[0].Table || []
          invoices = tables.map((table) => ({
            invoiceNumber: table.InvoiceNumber ? table.InvoiceNumber[0] : "",
            orderNumber: table.OrderNumber ? table.OrderNumber[0] : "",
            poNumber: table.PONumber ? table.PONumber[0] : "",
            date: table.InvoiceDate ? table.InvoiceDate[0] : "",
            total: table.Total ? Number.parseFloat(table.Total[0]) : 0,
            status: table.Status ? table.Status[0] : "Unknown",
          }))
        }
      }
    })

    return invoices
  } catch (error) {
    console.error("Error extracting invoices from XML:", error)
    return []
  }
}
