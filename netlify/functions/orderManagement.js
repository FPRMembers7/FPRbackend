const axios = require("axios")
const https = require("https")

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" }
  }

  try {
    const data = JSON.parse(event.body)
    const { orderData, items, credentials } = data

    if (!orderData || !items || !credentials) {
      return { statusCode: 400, body: "Missing orderData, items, or credentials" }
    }

    // Add Order Header
    const headerResult = await addOrderHeader(orderData, credentials)

    if (!headerResult.success) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Failed to add order header", error: headerResult.error }),
      }
    }

    const orderNumber = headerResult.orderNumber

    // Add Order Details
    for (const item of items) {
      const detailResult = await addOrderDetail(orderNumber, item, credentials)
      if (!detailResult.success) {
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: `Failed to add order detail for item ${item.ITEMNO}`,
            error: detailResult.error,
          }),
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Order placed successfully", orderNumber: orderNumber }),
    }
  } catch (error) {
    console.error("Error:", error)
    return { statusCode: 500, body: JSON.stringify({ message: "Internal Server Error", error: error.message }) }
  }
}

// Fix the addOrderHeader function:
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
        <SalesMessage>Online Order</SalesMessage>
        <ShipVIA>${orderData.shippingMethod}</ShipVIA>
        <ShipToName>${orderData.shipName}</ShipToName>
        <ShipToAttn>${orderData.shipCompany || ""}</ShipToAttn>
        <ShipToAddr1>${orderData.shipAddress}</ShipToAddr1>
        <ShipToAddr2></ShipToAddr2>
        <ShipToCity>${orderData.shipCity}</ShipToCity>
        <ShipToState>${orderData.shipState}</ShipToState>
        <ShipToZip>${orderData.shipZip}</ShipToZip>
        <ShipToPhone></ShipToPhone>
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
    })

    // Simple XML parsing to extract order number
    const orderNumberMatch = response.data.match(/<AddHeaderResult>(\d+)<\/AddHeaderResult>/)
    const orderNumber = orderNumberMatch ? Number.parseInt(orderNumberMatch[1]) : 0

    return {
      success: orderNumber && orderNumber > 0,
      orderNumber: orderNumber,
    }
  } catch (error) {
    console.error("AddHeader error:", error)
    return { success: false, error: error.message }
  }
}

// Fix the addOrderDetail function:
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
    })

    // Simple XML parsing to extract boolean result
    const resultMatch = response.data.match(/<AddDetailResult>(true|false|1|0)<\/AddDetailResult>/i)
    const success = resultMatch ? resultMatch[1].toLowerCase() === "true" || resultMatch[1] === "1" : false

    return { success }
  } catch (error) {
    console.error("AddDetail error:", error)
    return { success: false, error: error.message }
  }
}
