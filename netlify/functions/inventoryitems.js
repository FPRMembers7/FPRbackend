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

  // Parse request body to get pagination parameters
  const { page = 1, pageSize = 10 } = JSON.parse(event.body || "{}")

  // Calculate lastItem for pagination
  // For first page, use -1, for subsequent pages calculate based on previous items
  const lastItem = page === 1 ? -1 : (page - 1) * pageSize - 1

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <DailyItemUpdate xmlns="http://webservices.theshootingwarehouse.com/smart/Inventory.asmx">
        <CustomerNumber>99994</CustomerNumber>
        <UserName>99994</UserName>
        <Password>12345</Password>
        <LastUpdate>1/1/1990</LastUpdate>
        <LastItem>${lastItem}</LastItem>
        <Source>FPR</Source>
      </DailyItemUpdate>
    </soap:Body>
  </soap:Envelope>`

  try {
    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/inventory.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Inventory.asmx/DailyItemUpdate",
      },
    })

    // Extract data from SOAP XML response (same as original logic)
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
            CATEGORY: get("CATEGORY") || "Firearms",
            MANUFACTURER: get("MANUFACTURER") || "Various",
            WEIGHT: get("WEIGHT") || "0",
            CALIBER: get("CALIBER") || "",
            BARREL_LENGTH: get("BARREL_LENGTH") || "",
            ACTION_TYPE: get("ACTION_TYPE") || "",
          }
        })
      } catch (e) {
        console.error("Error processing XML:", e)
        return []
      }
    }

    // Since we're in Node.js environment, we need to use a different approach
    // Let's use regex to extract the data (simpler approach)
    function extractDataSimple(xmlString) {
      try {
        // Find all Table elements
        const tableRegex = /<Table[^>]*>([\s\S]*?)<\/Table>/g
        const tables = []
        let match

        while ((match = tableRegex.exec(xmlString)) !== null) {
          tables.push(match[1])
        }

        return tables.slice(0, pageSize).map((tableContent) => {
          const getValue = (tag) => {
            const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, "i")
            const match = tableContent.match(regex)
            return match ? match[1].trim() : ""
          }

          return {
            ITEMNO: getValue("ITEMNO"),
            IDESC: getValue("IDESC"),
            ITUPC: getValue("ITUPC"),
            PRC1: getValue("PRC1"),
            QTYOH: getValue("QTYOH"),
            CATEGORY: getValue("CATEGORY") || "Firearms",
            MANUFACTURER: getValue("MANUFACTURER") || "Various",
            WEIGHT: getValue("WEIGHT") || "0",
            CALIBER: getValue("CALIBER") || "",
            BARREL_LENGTH: getValue("BARREL_LENGTH") || "",
            ACTION_TYPE: getValue("ACTION_TYPE") || "",
          }
        })
      } catch (error) {
        console.error("Error extracting data:", error)
        return []
      }
    }

    const items = extractDataSimple(response.data)

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        items: items,
        page: page,
        pageSize: pageSize,
        hasMore: items.length === pageSize,
        totalFetched: items.length,
        xml: response.data, // Include raw XML for debugging if needed
      }),
    }
  } catch (error) {
    console.error("SOAP request error:", error)
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
