const axios = require("axios")
const https = require("https")

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

function extractBooleanResult(xmlString) {
  const addDetailResult = parseXMLResponse(xmlString, "AddDetailResult")
  const submitResult = parseXMLResponse(xmlString, "SubmitResult")

  const result = addDetailResult || submitResult
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
    const { orderData, items, credentials } = data

    if (!orderData || !items || !credentials) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "Missing orderData, items, or credentials" }),
      }
    }

    console.log("Processing order with data:", { orderData, itemCount: items.length })

    // Step 1: Add Order Header
    const headerResult = await addOrderHeader(orderData, credentials)

    if (!headerResult.success) {
      console.error("Failed to add order header:", headerResult.error)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: "Failed to add order header",
          error: headerResult.error,
        }),
      }
    }

    const orderNumber = headerResult.orderNumber
    console.log("Order header created with number:", orderNumber)

    // Step 2: Add Order Details
    for (const item of items) {
      console.log("Adding item to order:", item.ITEMNO)
      const detailResult = await addOrderDetail(orderNumber, item, credentials)
      if (!detailResult.success) {
        console.error("Failed to add order detail:", detailResult.error)
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            message: `Failed to add order detail for item ${item.ITEMNO}`,
            error: detailResult.error,
          }),
        }
      }
    }

    // Step 3: Submit Order (optional - you may want to submit manually)
    const submitResult = await submitOrder(orderNumber, credentials)
    if (!submitResult.success) {
      console.warn("Order created but submission failed:", submitResult.error)
      // Don't fail the entire order if submission fails
    }

    console.log("Order completed successfully:", orderNumber)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: "Order placed successfully",
        orderNumber: orderNumber,
        submitted: submitResult.success,
      }),
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

// Add Order Header
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
        <SalesMessage>Online Order - ${orderData.orderNotes || ""}</SalesMessage>
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
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/orders.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Orders.asmx/AddHeader",
      },
      timeout: 30000, // 30 second timeout
    })

    console.log("AddHeader response status:", response.status)

    // Parse order number from response
    const orderNumberMatch = response.data.match(/<AddHeaderResult>(\d+)<\/AddHeaderResult>/)
    const orderNumber = orderNumberMatch ? Number.parseInt(orderNumberMatch[1]) : 0

    console.log("Extracted order number:", orderNumber)

    return {
      success: orderNumber && orderNumber > 0,
      orderNumber: orderNumber,
    }
  } catch (error) {
    console.error("AddHeader error:", error.message)
    return {
      success: false,
      error: error.response?.data || error.message,
    }
  }
}

// Add Order Detail
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
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/orders.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Orders.asmx/AddDetail",
      },
      timeout: 30000,
    })

    // Parse boolean result from response
    const resultMatch = response.data.match(/<AddDetailResult>(true|false|1|0)<\/AddDetailResult>/i)
    const success = resultMatch ? resultMatch[1].toLowerCase() === "true" || resultMatch[1] === "1" : false

    return { success }
  } catch (error) {
    console.error("AddDetail error:", error.message)
    return {
      success: false,
      error: error.response?.data || error.message,
    }
  }
}

// Submit Order (optional)
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
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/orders.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Orders.asmx/Submit",
      },
      timeout: 30000,
    })

    // Parse boolean result from response
    const resultMatch = response.data.match(/<SubmitResult>(true|false|1|0)<\/SubmitResult>/i)
    const success = resultMatch ? resultMatch[1].toLowerCase() === "true" || resultMatch[1] === "1" : false

    return { success }
  } catch (error) {
    console.error("Submit error:", error.message)
    return {
      success: false,
      error: error.response?.data || error.message,
    }
  }
}
