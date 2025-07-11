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
    const { lastUpdate = "1/1/1990", lastItem = 1, pageSize = 10 } = JSON.parse(event.body || "{}")

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
    console.log("SOAP Body:", soapBody)

    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/inventory.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://webservices.theshootingwarehouse.com/smart/Inventory.asmx/DailyItemUpdate",
      },
      timeout: 30000,
    })

    console.log("SOAP Response Status:", response.status)
    console.log("SOAP Response Headers:", response.headers)
    console.log("SOAP Response Length:", response.data.length)
    console.log("SOAP Response Preview:", response.data.substring(0, 1000))

    // Extract items using regex-based approach
    const items = extractDataWithRegex(response.data)

    const hasMore = items.length >= 1000
    const nextLastItem =
      items.length > 0 ? Math.max(...items.map((item) => Number.parseInt(item.ITEMNO) || 0)) : lastItem

    console.log(`Extracted ${items.length} items. HasMore: ${hasMore}, NextLastItem: ${nextLastItem}`)

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
        debug: {
          responseLength: response.data.length,
          responsePreview: response.data.substring(0, 500),
        },
      }),
    }
  } catch (error) {
    console.error("API Error:", error.message)
    console.error("Error Stack:", error.stack)
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
        stack: error.stack,
      }),
    }
  }
}

function extractDataWithRegex(xmlString) {
  console.log("=== REGEX EXTRACTION START ===")
  console.log("XML Length:", xmlString.length)

  try {
    // First, let's see what the actual response looks like
    console.log("Raw XML Response (first 2000 chars):", xmlString.substring(0, 2000))

    // Look for the result content - it might be in different tags
    let dataContent = ""

    // Try different result tag patterns
    const resultPatterns = [
      /<DailyItemUpdateResult[^>]*>(.*?)<\/DailyItemUpdateResult>/s,
      /<DailyItemUpdateResponse[^>]*>(.*?)<\/DailyItemUpdateResponse>/s,
      /<soap:Body[^>]*>(.*?)<\/soap:Body>/s,
      /<Body[^>]*>(.*?)<\/Body>/s,
    ]

    for (const pattern of resultPatterns) {
      const match = xmlString.match(pattern)
      if (match) {
        dataContent = match[1]
        console.log("Found data using pattern:", pattern.source)
        console.log("Data content length:", dataContent.length)
        console.log("Data content preview:", dataContent.substring(0, 500))
        break
      }
    }

    if (!dataContent) {
      console.log("No result content found, using full XML")
      dataContent = xmlString
    }

    // Decode HTML entities
    dataContent = dataContent
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")

    console.log("After HTML decoding, length:", dataContent.length)
    console.log("Decoded preview:", dataContent.substring(0, 500))

    // Look for Table elements
    const tablePattern = /<Table[^>]*>(.*?)<\/Table>/gs
    const tableMatches = dataContent.match(tablePattern)

    if (!tableMatches) {
      console.log("No Table elements found")

      // Try alternative patterns
      const altPatterns = [/<Item[^>]*>(.*?)<\/Item>/gs, /<Record[^>]*>(.*?)<\/Record>/gs, /<Row[^>]*>(.*?)<\/Row>/gs]

      for (const altPattern of altPatterns) {
        const altMatches = dataContent.match(altPattern)
        if (altMatches) {
          console.log("Found alternative pattern:", altPattern.source, "matches:", altMatches.length)
          return extractItemsFromMatches(altMatches)
        }
      }

      console.log("No data patterns found")
      return []
    }

    console.log("Found", tableMatches.length, "Table elements")
    return extractItemsFromMatches(tableMatches)
  } catch (error) {
    console.error("Regex extraction error:", error)
    return []
  }
}

function extractItemsFromMatches(matches) {
  const items = []

  matches.forEach((match, index) => {
    const getField = (fieldName) => {
      const patterns = [
        new RegExp(`<${fieldName}[^>]*>(.*?)<\/${fieldName}>`, "is"),
        new RegExp(`<${fieldName}>(.*?)<\/${fieldName}>`, "is"),
      ]

      for (const pattern of patterns) {
        const fieldMatch = match.match(pattern)
        if (fieldMatch) {
          return fieldMatch[1].trim()
        }
      }
      return ""
    }

    const item = {
      ITEMNO: getField("ITEMNO"),
      IDESC: getField("IDESC"),
      ITUPC: getField("ITUPC"),
      PRC1: getField("PRC1"),
      QTYOH: getField("QTYOH"),
    }

    // Only add items with at least an item number
    if (item.ITEMNO) {
      items.push(item)

      if (index < 5) {
        console.log(`Sample item ${index + 1}:`, item)
      }
    }
  })

  console.log("=== REGEX EXTRACTION END ===")
  console.log("Total items extracted:", items.length)
  return items
}
