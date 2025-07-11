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

    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/inventory.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Inventory.asmx/DailyItemUpdate",
      },
      timeout: 30000, // 30 second timeout
    })

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
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlString, "text/xml")

    const parserError = xmlDoc.querySelector("parsererror")
    if (parserError) {
      console.error("XML parsing error:", parserError.textContent)
      return []
    }

    let dataContent = ""
    const updateResult = xmlDoc.querySelector("DailyItemUpdateResult")
    if (updateResult) {
      dataContent = updateResult.textContent || updateResult.innerHTML
    }

    if (!dataContent) {
      console.error("Could not find data content in SOAP response")
      return []
    }

    let innerXmlDoc
    try {
      innerXmlDoc = parser.parseFromString(dataContent, "text/xml")
    } catch (e) {
      const unescapedContent = dataContent
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")

      innerXmlDoc = parser.parseFromString(unescapedContent, "text/xml")
    }

    const tables = Array.from(innerXmlDoc.getElementsByTagName("Table"))

    if (tables.length === 0) {
      const alternativeContainers = ["NewDataSet", "DataSet", "diffgr:diffgram", "diffgram"]
      for (const containerName of alternativeContainers) {
        const container = innerXmlDoc.querySelector(containerName)
        if (container) {
          const tablesInContainer = Array.from(container.getElementsByTagName("Table"))
          if (tablesInContainer.length > 0) {
            tables.push(...tablesInContainer)
            break
          }
        }
      }
    }

    return tables.map((table) => {
      const get = (tag) => {
        const element = table.getElementsByTagName(tag)[0]
        return element ? element.textContent.trim() : ""
      }

      return {
        ITEMNO: get("ITEMNO"),
        IDESC: get("IDESC"),
        ITUPC: get("ITUPC"),
        PRC1: get("PRC1"),
        QTYOH: get("QTYOH"),
      }
    })
  } catch (e) {
    console.error("Error processing XML:", e)
    return []
  }
}
