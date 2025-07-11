const axios = require("axios")
const https = require("https")
// Add this line to handle XML parsing in Node.js
const { DOMParser } = require("xmldom")

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
function extractDataFromSoapXml(xmlString) {
  try {
    console.log("=== XML PARSING DEBUG START ===")
    console.log("Raw XML response length:", xmlString.length)
    console.log("First 1000 characters of XML:", xmlString.substring(0, 1000))
    console.log("Last 500 characters of XML:", xmlString.substring(xmlString.length - 500))

    // Check if we're running in Node.js environment (Netlify function)
    let parser, xmlDoc

    if (typeof DOMParser !== "undefined") {
      // Browser environment
      parser = new DOMParser()
      xmlDoc = parser.parseFromString(xmlString, "text/xml")
    } else {
      // Node.js environment - we need to use a different XML parser
      console.log("Running in Node.js environment, need XML parser")

      // For now, let's try a simple regex approach to extract data
      const items = extractWithRegex(xmlString)
      console.log("Regex extraction found", items.length, "items")
      return items
    }

    const parserError = xmlDoc.querySelector("parsererror")
    if (parserError) {
      console.error("XML parsing error:", parserError.textContent)
      return []
    }

    console.log("XML parsed successfully")
    console.log("Root element:", xmlDoc.documentElement ? xmlDoc.documentElement.tagName : "No root element")

    // Look for the DailyItemUpdateResult element
    let dataContent = ""
    const updateResult = xmlDoc.querySelector("DailyItemUpdateResult")
    if (updateResult) {
      dataContent = updateResult.textContent || updateResult.innerHTML
      console.log("Found DailyItemUpdateResult, content length:", dataContent.length)
      console.log("DailyItemUpdateResult content preview:", dataContent.substring(0, 500))
    } else {
      console.error("Could not find DailyItemUpdateResult in SOAP response")

      // Log all available elements
      const allElements = Array.from(xmlDoc.querySelectorAll("*"))
      console.log(
        "All available elements:",
        allElements.map((el) => el.tagName),
      )

      // Try alternative result element names
      const alternatives = ["DailyItemUpdateResponse", "Body", "Envelope"]
      for (const alt of alternatives) {
        const altElement = xmlDoc.querySelector(alt)
        if (altElement) {
          console.log(`Found alternative element: ${alt}`)
          dataContent = altElement.textContent || altElement.innerHTML
          break
        }
      }

      if (!dataContent) {
        console.log(
          "Full XML structure:",
          xmlDoc.documentElement ? xmlDoc.documentElement.outerHTML : "No XML structure",
        )
        return []
      }
    }

    if (!dataContent) {
      console.error("No data content found")
      return []
    }

    // Try to parse the inner content
    let innerXmlDoc
    try {
      innerXmlDoc = parser.parseFromString(dataContent, "text/xml")

      const innerParserError = innerXmlDoc.querySelector("parsererror")
      if (innerParserError) {
        console.log("Inner XML parsing failed, trying to unescape...")
        const unescapedContent = dataContent
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")

        console.log("Unescaped content preview:", unescapedContent.substring(0, 500))
        innerXmlDoc = parser.parseFromString(unescapedContent, "text/xml")
      }
    } catch (e) {
      console.error("Error parsing inner XML:", e)
      return []
    }

    // Look for data tables
    const tables = Array.from(innerXmlDoc.getElementsByTagName("Table"))
    console.log("Found", tables.length, "Table elements")

    if (tables.length === 0) {
      console.log("No Table elements found, trying alternative approaches...")

      // Try different container names
      const containers = ["NewDataSet", "DataSet", "diffgr:diffgram", "diffgram", "DocumentElement", "Items", "Item"]
      for (const containerName of containers) {
        const container = innerXmlDoc.querySelector(containerName)
        if (container) {
          console.log(`Found container: ${containerName}`)
          const tablesInContainer = Array.from(container.getElementsByTagName("Table"))
          if (tablesInContainer.length > 0) {
            tables.push(...tablesInContainer)
            console.log(`Added ${tablesInContainer.length} tables from ${containerName}`)
            break
          }
        }
      }

      // If still no tables, log the inner XML structure
      if (tables.length === 0) {
        console.log("Inner XML root:", innerXmlDoc.documentElement ? innerXmlDoc.documentElement.tagName : "No root")
        console.log(
          "Inner XML structure:",
          innerXmlDoc.documentElement ? innerXmlDoc.documentElement.outerHTML.substring(0, 1000) : "No structure",
        )

        // Try regex extraction as fallback
        console.log("Trying regex extraction as fallback...")
        return extractWithRegex(xmlString)
      }
    }

    const items = tables.map((table, index) => {
      const get = (tag) => {
        const element = table.getElementsByTagName(tag)[0]
        return element ? element.textContent.trim() : ""
      }

      const item = {
        ITEMNO: get("ITEMNO"),
        IDESC: get("IDESC"),
        ITUPC: get("ITUPC"),
        PRC1: get("PRC1"),
        QTYOH: get("QTYOH"),
      }

      if (index < 3) {
        console.log(`Sample item ${index + 1}:`, item)
      }

      return item
    })

    console.log("=== XML PARSING DEBUG END ===")
    console.log("Successfully extracted", items.length, "items")
    return items
  } catch (e) {
    console.error("Error in extractDataFromSoapXml:", e)
    console.error("Error stack:", e.stack)

    // Try regex extraction as final fallback
    console.log("Trying regex extraction as final fallback...")
    return extractWithRegex(xmlString)
  }
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
