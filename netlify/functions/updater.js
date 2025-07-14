const axios = require("axios")
const https = require("https")
// Add this line to handle XML parsing in Node.js
// Remove the xmldom import
//- const { DOMParser } = require("xmldom")

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
    // Parse request body to get pagination parameters
    const {
      lastUpdate = "1/1/1990", // Default to get all items from 1990
      lastItem = 1, // Start from item 1, not -1
      pageSize = 10, // Default page size of 10 items
    } = JSON.parse(event.body || "{}")

    console.log(`Fetching items: lastUpdate=${lastUpdate}, lastItem=${lastItem}, pageSize=${pageSize}`)

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
    </soap:Envelope>`

    console.log("Making SOAP request...")

    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/inventory.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Inventory.asmx/DailyItemUpdate",
      },
      timeout: 30000, // 30 second timeout
    })

    console.log("SOAP request completed, status:", response.status)
    console.log("Response headers:", response.headers)
    console.log("Response data length:", response.data.length)

    // Extract items from XML response
    const items = extractDataFromSoapXml(response.data)

    // Determine if there are more items (if we got exactly 1000 items, there might be more)
    const hasMore = items.length >= 1000

    // Get the last item number for next pagination call
    const nextLastItem =
      items.length > 0 ? Math.max(...items.map((item) => Number.parseInt(item.ITEMNO) || 0)) : lastItem

    console.log(`Retrieved ${items.length} items. HasMore: ${hasMore}, NextLastItem: ${nextLastItem}`)

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        items: items,
        pagination: {
          currentLastItem: lastItem,
          nextLastItem: nextLastItem,
          hasMore: hasMore,
          itemCount: items.length,
        },
      }),
    }
  } catch (error) {
    console.error("API Error:", error.message)
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
    }
  }
}

// Extract data from SOAP XML response with extensive debugging
// In the `extractDataFromSoapXml` function, replace the entire content with a direct call to `extractWithRegex`.
// This removes the conditional logic and direct DOM parsing attempts.
function extractDataFromSoapXml(xmlString) {
  console.log("=== XML PARSING DEBUG START ===")
  console.log("Raw XML response length:", xmlString.length)
  console.log("First 1000 characters of XML:", xmlString.substring(0, 1000))
  console.log("Last 500 characters of XML:", xmlString.substring(xmlString.length - 500))

  // Directly use regex extraction as it's the most reliable method in this environment
  const items = extractWithRegex(xmlString)
  console.log("Regex extraction found", items.length, "items")
  console.log("=== XML PARSING DEBUG END ===")
  console.log("Successfully extracted", items.length, "items")
  return items
}

// Fallback regex-based extraction for Node.js environment
function extractWithRegex(xmlString) {
  console.log("Using regex extraction method...")

  const items = []

  // Look for Table elements using regex
  const tableRegex = /<Table[^>]*>(.*?)<\/Table>/gs
  const matches = xmlString.match(tableRegex)

  if (!matches) {
    console.log("No Table elements found with regex")
    return []
  }

  console.log("Found", matches.length, "Table elements with regex")

  matches.forEach((tableXml, index) => {
    const getField = (fieldName) => {
      const fieldRegex = new RegExp(`<${fieldName}[^>]*>(.*?)<\/${fieldName}>`, "i")
      const match = tableXml.match(fieldRegex)
      return match ? match[1].trim() : ""
    }

    const item = {
      ITEMNO: getField("ITEMNO"),
      IDESC: getField("IDESC"),
      ITUPC: getField("ITUPC"),
      PRC1: getField("PRC1"),
      QTYOH: getField("QTYOH"),
      ITATR1: getField("ITATR1"), // Add this line to extract the attribute
    }

    // Only add items that have at least an item number
    if (item.ITEMNO) {
      items.push(item)

      if (index < 3) {
        console.log(`Regex sample item ${index + 1}:`, item)
      }
    }
  })

  console.log("Regex extraction completed, found", items.length, "valid items")
  return items
}
