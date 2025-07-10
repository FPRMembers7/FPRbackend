const axios = require("axios")
const https = require("https")

// SOAP endpoints as specified
const ORDER_ENDPOINT = "http://webservices.theshootingwarehouse.com/smart/orders.asmx"
const INVOICE_ENDPOINT = "http://webservices.theshootingwarehouse.com/smart/invoices.asmx"

// Simple XML parser function to avoid external dependencies
function parseXMLResponse(xmlString, resultTag) {
  try {
    // Simple regex-based parsing for SOAP responses
    const regex = new RegExp(`<${resultTag}[^>]*>([^<]*)<\/${resultTag}>`, "i")
    const match = xmlString.match(regex)
    return match ? match[1].trim() : null
  } catch (e) {
    console.error("Error parsing XML:", e)
    return null
  }
}

function extractOrderNumber(xmlString) {
  const result = parseXMLResponse(xmlString, "AddHeaderResult")
  return result ? Number.parseInt(result) || 0 : 0
}

function extractBooleanResult(xmlString, resultTag = "AddDetailResult") {
  const result = parseXMLResponse(xmlString, resultTag)
  return result ? result.toLowerCase() === "true" || result === "1" : false
}

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  }

  // Handle preflight requests
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: "",
    }
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: "Method Not Allowed" }),
    }
  }

  try {
    const data = JSON.parse(event.body)
    const { orderData, items, credentials, action = "place-order" } = data

    // Handle different actions
    switch (action) {
      case "place-order":
        return await handlePlaceOrder(orderData, items, credentials, headers)
      case "get-order-detail":
        return await handleGetOrderDetail(data.orderNumber, credentials, headers)
      case "get-tracking":
        return await handleGetTracking(data.poNumber, credentials, headers)
      case "get-credits":
        return await handleGetCredits(data.startDate, data.endDate, credentials, headers)
      case "get-package-contents":
        return await handleGetPackageContents(data.orderNumber, credentials, headers)
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ message: "Invalid action specified" }),
        }
    }
  } catch (error) {
    console.error("Order processing error:", error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: "Internal Server Error",
        error: error.message,
      }),
    }
  }
}

// Main order placement handler
async function handlePlaceOrder(orderData, items, credentials, headers) {
  if (!orderData || !items || !credentials) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: "Missing orderData, items, or credentials" }),
    }
  }

  // Validate required fields
  const requiredFields = ["poNumber", "shipName", "shipAddress", "shipCity", "shipState", "shipZip"]
  const missingFields = requiredFields.filter((field) => !orderData[field])

  if (missingFields.length > 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        message: `Missing required fields: ${missingFields.join(", ")}`,
        orderData: orderData,
      }),
    }
  }

  console.log("Processing order with data:", {
    orderData: orderData,
    itemCount: items.length,
    credentials: { ...credentials, password: "***" }, // Don't log password
  })

  try {
    // Step 1: AddHeader - Creates the order shell
    console.log("Step 1: Creating order header...")
    const headerResult = await addOrderHeader(orderData, credentials)

    if (!headerResult.success) {
      console.error("Failed to add order header:", headerResult.error)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: "Failed to create order header",
          error: headerResult.error,
          statusCode: headerResult.statusCode,
          orderData: orderData,
        }),
      }
    }

    // Continue with rest of the function...
    const orderNumber = headerResult.orderNumber
    console.log("Order header created successfully with number:", orderNumber)

    // Step 2: AddDetail - Add each product from cart
    console.log("Step 2: Adding order details...")
    const failedItems = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      console.log(`Adding item ${i + 1}/${items.length}: ${item.ITEMNO}`)

      const detailResult = await addOrderDetail(orderNumber, item, credentials)
      if (!detailResult.success) {
        console.error(`Failed to add item ${item.ITEMNO}:`, detailResult.error)
        failedItems.push({
          itemNo: item.ITEMNO,
          description: item.IDESC,
          error: detailResult.error,
        })
      }
    }

    // If any items failed, return partial success
    if (failedItems.length > 0) {
      console.warn(`Order ${orderNumber} created but ${failedItems.length} items failed`)
      return {
        statusCode: 207, // Multi-status
        headers,
        body: JSON.stringify({
          message: "Order created with some items failed",
          orderNumber: orderNumber,
          failedItems: failedItems,
          submitted: false,
        }),
      }
    }

    // Step 3: Submit - Finalize and submit to Sports South
    console.log("Step 3: Submitting order to Sports South...")
    const submitResult = await submitOrder(orderNumber, credentials)

    if (!submitResult.success) {
      console.warn("Order created but submission failed:", submitResult.error)
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: "Order created but not submitted - please submit manually",
          orderNumber: orderNumber,
          submitted: false,
          submitError: submitResult.error,
        }),
      }
    }

    console.log("Order completed and submitted successfully:", orderNumber)

    // Get order details for confirmation popup
    const orderDetails = await getOrderDetail(orderNumber, orderData.poNumber, credentials)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: "Order placed and submitted successfully",
        orderNumber: orderNumber,
        poNumber: orderData.poNumber,
        submitted: true,
        orderDetails: orderDetails.success ? orderDetails.data : null,
      }),
    }
  } catch (error) {
    console.error("Order placement error:", error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: "Failed to process order",
        error: error.message,
        orderData: orderData,
      }),
    }
  }
}

// Step 1: AddHeader - Creates the order shell
async function addOrderHeader(orderData, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <AddHeader xmlns="http://webservices.theshootingwarehouse.com/smart/Orders.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <Source>${credentials.source}</Source>
        <PO>${orderData.poNumber}</PO>
        <CustomerOrderNumber>${orderData.poNumber}</CustomerOrderNumber>
        <SalesMessage>Online Order${orderData.orderNotes ? " - " + orderData.orderNotes.substring(0, 50) : ""}</SalesMessage>
        <ShipVIA>${orderData.shippingMethod || "GROUND"}</ShipVIA>
        <ShipToName>${orderData.shipName}</ShipToName>
        <ShipToAttn></ShipToAttn>
        <ShipToAddr1>${orderData.shipAddress}</ShipToAddr1>
        <ShipToAddr2>${orderData.shipAddress2 || ""}</ShipToAddr2>
        <ShipToCity>${orderData.shipCity}</ShipToCity>
        <ShipToState>${orderData.shipState}</ShipToState>
        <ShipToZip>${orderData.shipZip}</ShipToZip>
        <ShipToPhone>${orderData.shipPhone || ""}</ShipToPhone>
        <AdultSignature>false</AdultSignature>
        <Signature>false</Signature>
        <Insurance>false</Insurance>
      </AddHeader>
    </soap:Body>
  </soap:Envelope>`

  try {
    console.log("Sending AddHeader request with data:", {
      customerNumber: credentials.customerNumber,
      poNumber: orderData.poNumber,
      shipName: orderData.shipName,
      shipCity: orderData.shipCity,
      shipState: orderData.shipState,
    })

    const response = await axios.post(ORDER_ENDPOINT, soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Orders.asmx/AddHeader",
      },
      timeout: 30000,
    })

    console.log("AddHeader response status:", response.status)
    console.log("AddHeader response data:", response.data.substring(0, 500))

    const orderNumber = extractOrderNumber(response.data)
    console.log("Extracted order number:", orderNumber)

    return {
      success: orderNumber && orderNumber > 0,
      orderNumber: orderNumber,
      rawResponse: response.data,
    }
  } catch (error) {
    console.error("AddHeader error details:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data?.substring(0, 500),
    })

    return {
      success: false,
      error: error.response?.data || error.message,
      statusCode: error.response?.status,
    }
  }
}

// Step 2: AddDetail - Adds selected products based on ITEMNO from DailyItemUpdate
async function addOrderDetail(orderNumber, item, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <AddDetail xmlns="http://webservices.theshootingwarehouse.com/smart/Orders.asmx">
        <OrderNumber>${orderNumber}</OrderNumber>
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <Source>${credentials.source}</Source>
        <SSItemNumber>${item.ITEMNO}</SSItemNumber>
        <Quantity>${item.quantity}</Quantity>
        <OrderPrice>${Number.parseFloat(item.PRC1 || 0)}</OrderPrice>
        <CustomerItemNumber>${item.ITEMNO}</CustomerItemNumber>
        <CustomerItemDescription>${item.IDESC}</CustomerItemDescription>
      </AddDetail>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post(ORDER_ENDPOINT, soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Orders.asmx/AddDetail",
      },
      timeout: 30000,
    })

    const success = extractBooleanResult(response.data, "AddDetailResult")
    return { success }
  } catch (error) {
    console.error("AddDetail error:", error.message)
    return {
      success: false,
      error: error.response?.data || error.message,
    }
  }
}

// Step 3: Submit - Finalizes and submits the order to Sports South
async function submitOrder(orderNumber, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <Submit xmlns="http://webservices.theshootingwarehouse.com/smart/Orders.asmx">
        <OrderNumber>${orderNumber}</OrderNumber>
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <Source>${credentials.source}</Source>
      </Submit>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post(ORDER_ENDPOINT, soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Orders.asmx/Submit",
      },
      timeout: 30000,
    })

    const success = extractBooleanResult(response.data, "SubmitResult")
    return { success }
  } catch (error) {
    console.error("Submit error:", error.message)
    return {
      success: false,
      error: error.response?.data || error.message,
    }
  }
}

// Get order details for confirmation popup
async function getOrderDetail(orderNumber, customerOrderNumber, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <GetDetail xmlns="http://webservices.theshootingwarehouse.com/smart/Orders.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <OrderNumber>${orderNumber}</OrderNumber>
        <CustomerOrderNumber>${customerOrderNumber}</CustomerOrderNumber>
        <Source>${credentials.source}</Source>
      </GetDetail>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post(ORDER_ENDPOINT, soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Orders.asmx/GetDetail",
      },
      timeout: 30000,
    })

    console.log("GetDetail response:", response.data.substring(0, 500))

    // Parse the order details from XML response
    const orderData = parseXMLResponse(response.data, "GetDetailResult")

    return {
      success: !!orderData,
      data: orderData,
      rawResponse: response.data,
    }
  } catch (error) {
    console.error("GetDetail error:", error.message)
    return {
      success: false,
      error: error.response?.data || error.message,
    }
  }
}

// Get order header information for confirmation
async function getOrderHeader(orderNumber, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <GetHeader xmlns="http://webservices.theshootingwarehouse.com/smart/Orders.asmx">
        <OrderNumber>${orderNumber}</OrderNumber>
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <Source>${credentials.source}</Source>
      </GetHeader>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post(ORDER_ENDPOINT, soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Orders.asmx/GetHeader",
      },
      timeout: 30000,
    })

    // Parse the order header from XML response
    const headerData = parseXMLResponse(response.data, "GetHeaderResult")

    return {
      success: !!headerData,
      data: headerData,
    }
  } catch (error) {
    console.error("GetHeader error:", error.message)
    return {
      success: false,
      error: error.response?.data || error.message,
    }
  }
}

// Optional: GetTrackingByPO - Retrieve tracking numbers (recommended for customer emails)
async function getTrackingByPO(poNumber, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <GetTrackingByPO xmlns="http://webservices.theshootingwarehouse.com/smart/Invoices.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <Source>${credentials.source}</Source>
        <PO>${poNumber}</PO>
      </GetTrackingByPO>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post(INVOICE_ENDPOINT, soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Invoices.asmx/GetTrackingByPO",
      },
      timeout: 30000,
    })

    const trackingData = parseXMLResponse(response.data, "GetTrackingByPOResult")

    return {
      success: !!trackingData,
      data: trackingData,
    }
  } catch (error) {
    console.error("GetTrackingByPO error:", error.message)
    return {
      success: false,
      error: error.response?.data || error.message,
    }
  }
}

// Optional: GetCreditsByDate - Check for any credits/refunds
async function getCreditsByDate(startDate, endDate, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <GetCreditsByDate xmlns="http://webservices.theshootingwarehouse.com/smart/Invoices.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <Source>${credentials.source}</Source>
        <StartDate>${startDate}</StartDate>
        <EndDate>${endDate}</EndDate>
      </GetCreditsByDate>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post(INVOICE_ENDPOINT, soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Invoices.asmx/GetCreditsByDate",
      },
      timeout: 30000,
    })

    const creditsData = parseXMLResponse(response.data, "GetCreditsByDateResult")

    return {
      success: !!creditsData,
      data: creditsData,
    }
  } catch (error) {
    console.error("GetCreditsByDate error:", error.message)
    return {
      success: false,
      error: error.response?.data || error.message,
    }
  }
}

// Optional: GetPackageContents - If orders return multiple packages
async function getPackageContents(orderNumber, credentials) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <GetPackageContents xmlns="http://webservices.theshootingwarehouse.com/smart/Invoices.asmx">
        <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
        <UserName>${credentials.userName}</UserName>
        <Password>${credentials.password}</Password>
        <Source>${credentials.source}</Source>
        <OrderNumber>${orderNumber}</OrderNumber>
      </GetPackageContents>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post(INVOICE_ENDPOINT, soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Invoices.asmx/GetPackageContents",
      },
      timeout: 30000,
    })

    const packageData = parseXMLResponse(response.data, "GetPackageContentsResult")

    return {
      success: !!packageData,
      data: packageData,
    }
  } catch (error) {
    console.error("GetPackageContents error:", error.message)
    return {
      success: false,
      error: error.response?.data || error.message,
    }
  }
}

// Handler functions for different actions
async function handleGetOrderDetail(orderNumber, credentials, headers) {
  if (!orderNumber || !credentials) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: "Missing orderNumber or credentials" }),
    }
  }

  const result = await getOrderDetail(orderNumber, credentials)

  return {
    statusCode: result.success ? 200 : 500,
    headers,
    body: JSON.stringify(result),
  }
}

async function handleGetTracking(poNumber, credentials, headers) {
  if (!poNumber || !credentials) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: "Missing poNumber or credentials" }),
    }
  }

  const result = await getTrackingByPO(poNumber, credentials)

  return {
    statusCode: result.success ? 200 : 500,
    headers,
    body: JSON.stringify(result),
  }
}

async function handleGetCredits(startDate, endDate, credentials, headers) {
  if (!startDate || !endDate || !credentials) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: "Missing date range or credentials" }),
    }
  }

  const result = await getCreditsByDate(startDate, endDate, credentials)

  return {
    statusCode: result.success ? 200 : 500,
    headers,
    body: JSON.stringify(result),
  }
}

async function handleGetPackageContents(orderNumber, credentials, headers) {
  if (!orderNumber || !credentials) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: "Missing orderNumber or credentials" }),
    }
  }

  const result = await getPackageContents(orderNumber, credentials)

  return {
    statusCode: result.success ? 200 : 500,
    headers,
    body: JSON.stringify(result),
  }
}
