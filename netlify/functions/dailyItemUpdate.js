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

// Extract data from SOAP XML response
function extractDataFromSoapXml(xmlString) {
  try {
    console.log("Raw XML response length:", xmlString.length)

    // First, try to parse the outer SOAP envelope
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlString, "text/xml")

    const parserError = xmlDoc.querySelector("parsererror")
    if (parserError) {
      console.error("XML parsing error:", parserError.textContent)
      return []
    }

    // Look for the DailyItemUpdateResult element
    let dataContent = ""
    const updateResult = xmlDoc.querySelector("DailyItemUpdateResult")
    if (updateResult) {
      dataContent = updateResult.textContent || updateResult.innerHTML
      console.log("Found DailyItemUpdateResult, content length:", dataContent.length)
    } else {
      console.error("Could not find DailyItemUpdateResult in SOAP response")
      console.log(
        "Available elements:",
        Array.from(xmlDoc.querySelectorAll("*")).map((el) => el.tagName),
      )
      return []
    }

    if (!dataContent) {
      console.error("DailyItemUpdateResult is empty")
      return []
    }

    // The content might be HTML-encoded, so decode it
    let innerXmlDoc
    try {
      // First try parsing as-is
      innerXmlDoc = parser.parseFromString(dataContent, "text/xml")

      // Check if parsing failed, then try unescaping
      const innerParserError = innerXmlDoc.querySelector("parsererror")
      if (innerParserError) {
        console.log("Direct parsing failed, trying to unescape HTML entities...")
        const unescapedContent = dataContent
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")

        innerXmlDoc = parser.parseFromString(unescapedContent, "text/xml")
        console.log("Unescaped content length:", unescapedContent.length)
      }
    } catch (e) {
      console.error("Error parsing inner XML:", e)
      return []
    }

    // Look for Table elements in various possible containers
    const tables = Array.from(innerXmlDoc.getElementsByTagName("Table"))
    console.log("Found", tables.length, "Table elements")

    if (tables.length === 0) {
      // Try alternative container names
      const alternativeContainers = ["NewDataSet", "DataSet", "diffgr:diffgram", "diffgram", "DocumentElement"]
      for (const containerName of alternativeContainers) {
        const container = innerXmlDoc.querySelector(containerName)
        if (container) {
          console.log("Found container:", containerName)
          const tablesInContainer = Array.from(container.getElementsByTagName("Table"))
          if (tablesInContainer.length > 0) {
            tables.push(...tablesInContainer)
            console.log("Found", tablesInContainer.length, "tables in", containerName)
            break
          }
        }
      }
    }

    if (tables.length === 0) {
      console.error("No Table elements found in XML")
      console.log(
        "Inner XML structure:",
        innerXmlDoc.documentElement ? innerXmlDoc.documentElement.outerHTML.substring(0, 500) : "No document element",
      )
      return []
    }

    console.log("Processing", tables.length, "table records...")

    const items = tables.map((table, index) => {
      const get = (tag) => {
        const element = table.getElementsByTagName(tag)[0]
        const value = element ? element.textContent.trim() : ""
        return value
      }

      const item = {
        ITEMNO: get("ITEMNO"),
        IDESC: get("IDESC"),
        ITUPC: get("ITUPC"),
        PRC1: get("PRC1"),
        QTYOH: get("QTYOH"),
      }

      // Log first few items for debugging
      if (index < 3) {
        console.log(`Item ${index + 1}:`, item)
      }

      return item
    })

    console.log("Successfully extracted", items.length, "items")
    return items
  } catch (e) {
    console.error("Error processing XML:", e)
    console.error("Error stack:", e.stack)
    return []
  }
}
