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
    const {
      action,
      poNumber,
      orderNumber,
      startDate,
      endDate,
      credentials = {
        customerNumber: "99994",
        userName: "99994",
        password: "12345",
        source: "FPR",
      },
    } = JSON.parse(event.body || "{}")

    console.log(`Invoice tracking request: action=${action}, poNumber=${poNumber}, orderNumber=${orderNumber}`)

    let soapBody = ""
    let soapAction = ""

    switch (action) {
      case "get-by-po":
        soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                       xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                       xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
            <GetByPONumber xmlns="http://webservices.theshootingwarehouse.com/smart/Invoices.asmx">
              <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
              <UserName>${credentials.userName}</UserName>
              <Password>${credentials.password}</Password>
              <PONumber>${poNumber}</PONumber>
              <Source>${credentials.source}</Source>
            </GetByPONumber>
          </soap:Body>
        </soap:Envelope>`
        soapAction = "http://webservices.theshootingwarehouse.com/smart/Invoices.asmx/GetByPONumber"
        break

      case "get-by-order":
        soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                       xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                       xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
            <GetByOrderNumber xmlns="http://webservices.theshootingwarehouse.com/smart/Invoices.asmx">
              <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
              <UserName>${credentials.userName}</UserName>
              <Password>${credentials.password}</Password>
              <OrderNumber>${orderNumber}</OrderNumber>
              <Source>${credentials.source}</Source>
            </GetByOrderNumber>
          </soap:Body>
        </soap:Envelope>`
        soapAction = "http://webservices.theshootingwarehouse.com/smart/Invoices.asmx/GetByOrderNumber"
        break

      case "get-by-date":
        soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                       xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                       xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
            <GetByDate xmlns="http://webservices.theshootingwarehouse.com/smart/Invoices.asmx">
              <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
              <UserName>${credentials.userName}</UserName>
              <Password>${credentials.password}</Password>
              <StartDate>${startDate}</StartDate>
              <EndDate>${endDate}</EndDate>
              <Source>${credentials.source}</Source>
            </GetByDate>
          </soap:Body>
        </soap:Envelope>`
        soapAction = "http://webservices.theshootingwarehouse.com/smart/Invoices.asmx/GetByDate"
        break

      case "get-tracking":
        soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                       xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                       xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
            <GetTrackingByPO xmlns="http://webservices.theshootingwarehouse.com/smart/Invoices.asmx">
              <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
              <UserName>${credentials.userName}</UserName>
              <Password>${credentials.password}</Password>
              <PONumber>${poNumber}</PONumber>
              <Source>${credentials.source}</Source>
            </GetTrackingByPO>
          </soap:Body>
        </soap:Envelope>`
        soapAction = "http://webservices.theshootingwarehouse.com/smart/Invoices.asmx/GetTrackingByPO"
        break

      case "get-package-contents":
        soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                       xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                       xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
            <GetPackageContents xmlns="http://webservices.theshootingwarehouse.com/smart/Invoices.asmx">
              <CustomerNumber>${credentials.customerNumber}</CustomerNumber>
              <UserName>${credentials.userName}</UserName>
              <Password>${credentials.password}</Password>
              <PONumber>${poNumber}</PONumber>
              <Source>${credentials.source}</Source>
            </GetPackageContents>
          </soap:Body>
        </soap:Envelope>`
        soapAction = "http://webservices.theshootingwarehouse.com/smart/Invoices.asmx/GetPackageContents"
        break

      default:
        throw new Error(`Unknown action: ${action}`)
    }

    console.log("Making SOAP request to invoices API...")

    const response = await axios.post("http://webservices.theshootingwarehouse.com/smart/invoices.asmx", soapBody, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: soapAction,
      },
      timeout: 30000,
    })

    console.log("SOAP request completed, status:", response.status)

    // Extract data from XML response
    const invoiceData = extractInvoiceDataFromXml(response.data, action)

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        action: action,
        data: invoiceData,
      }),
    }
  } catch (error) {
    console.error("Invoice API Error:", error.message)
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: false,
        message: "Invoice request failed",
        error: error.message,
      }),
    }
  }
}

// Extract invoice data from SOAP XML response
function extractInvoiceDataFromXml(xmlString, action) {
  try {
    console.log("Extracting invoice data for action:", action)
    console.log("XML response length:", xmlString.length)

    // Use regex to extract the result content
    let resultContent = ""

    // Different result element names based on action
    const resultElementMap = {
      "get-by-po": "GetByPONumberResult",
      "get-by-order": "GetByOrderNumberResult",
      "get-by-date": "GetByDateResult",
      "get-tracking": "GetTrackingByPOResult",
      "get-package-contents": "GetPackageContentsResult",
    }

    const resultElement = resultElementMap[action] || "Result"
    const resultRegex = new RegExp(`<${resultElement}[^>]*>(.*?)<\/${resultElement}>`, "gs")
    const resultMatch = xmlString.match(resultRegex)

    if (resultMatch && resultMatch[0]) {
      resultContent = resultMatch[0]
      // Remove the outer result tags
      resultContent = resultContent.replace(new RegExp(`<${resultElement}[^>]*>|<\/${resultElement}>`, "g"), "")

      // Unescape HTML entities
      resultContent = resultContent
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    }

    if (!resultContent) {
      console.log("No result content found")
      return null
    }

    console.log("Result content preview:", resultContent.substring(0, 500))

    // Parse based on action type
    switch (action) {
      case "get-by-po":
      case "get-by-order":
      case "get-by-date":
        return parseInvoiceHeaders(resultContent)

      case "get-tracking":
        return parseTrackingInfo(resultContent)

      case "get-package-contents":
        return parsePackageContents(resultContent)

      default:
        return { rawData: resultContent }
    }
  } catch (error) {
    console.error("Error extracting invoice data:", error)
    return { error: error.message, rawData: xmlString.substring(0, 1000) }
  }
}

// Parse invoice headers (for GetByPO, GetByOrder, GetByDate)
function parseInvoiceHeaders(xmlContent) {
  const invoices = []

  // Extract Table elements
  const tableRegex = /<Table[^>]*>(.*?)<\/Table>/gs
  const tableMatches = xmlContent.match(tableRegex)

  if (!tableMatches) {
    console.log("No Table elements found in invoice headers")
    return { invoices: [], rawData: xmlContent.substring(0, 500) }
  }

  console.log("Found", tableMatches.length, "invoice records")

  tableMatches.forEach((tableXml, index) => {
    const getField = (fieldName) => {
      const fieldRegex = new RegExp(`<${fieldName}[^>]*>(.*?)<\/${fieldName}>`, "i")
      const match = tableXml.match(fieldRegex)
      return match ? match[1].trim() : ""
    }

    const invoice = {
      customerNumber: getField("S1CUST"),
      invoiceDate: getField("S1DATE"),
      invoiceNumber: getField("S1INV"),
      poNumber: getField("PONBR"),
      grossSales: Number.parseFloat(getField("INVGS")) || 0,
      tax: Number.parseFloat(getField("TAX")) || 0,
      cashDiscount: Number.parseFloat(getField("INVCDC")) || 0,
      dueDate: getField("DUEDT"),
      shippingType: getField("S1SHTP"),
      airCode: getField("S1AIR"),
      source: getField("S1EDI"),
      pastDue: getField("PASTDUE") === "1",
    }

    // Format dates
    if (invoice.invoiceDate) {
      invoice.formattedInvoiceDate = formatDate(invoice.invoiceDate)
    }
    if (invoice.dueDate) {
      invoice.formattedDueDate = formatDate(invoice.dueDate)
    }

    // Calculate total
    invoice.total = invoice.grossSales + invoice.tax - invoice.cashDiscount

    invoices.push(invoice)

    if (index < 3) {
      console.log(`Sample invoice ${index + 1}:`, invoice)
    }
  })

  return { invoices, count: invoices.length }
}

// Parse tracking information
function parseTrackingInfo(xmlContent) {
  const tracking = []

  const tableRegex = /<Table[^>]*>(.*?)<\/Table>/gs
  const tableMatches = xmlContent.match(tableRegex)

  if (!tableMatches) {
    return { tracking: [], rawData: xmlContent.substring(0, 500) }
  }

  tableMatches.forEach((tableXml) => {
    const getField = (fieldName) => {
      const fieldRegex = new RegExp(`<${fieldName}[^>]*>(.*?)<\/${fieldName}>`, "i")
      const match = tableXml.match(fieldRegex)
      return match ? match[1].trim() : ""
    }

    const trackingInfo = {
      poNumber: getField("PONBR"),
      trackingNumber: getField("TRACKING"),
      carrier: getField("CARRIER"),
      service: getField("SERVICE"),
      shipDate: getField("SHIPDATE"),
      packageCount: getField("PACKAGES"),
      weight: getField("WEIGHT"),
      status: getField("STATUS"),
    }

    if (trackingInfo.trackingNumber) {
      tracking.push(trackingInfo)
    }
  })

  return { tracking, count: tracking.length }
}

// Parse package contents
function parsePackageContents(xmlContent) {
  const packages = []

  const tableRegex = /<Table[^>]*>(.*?)<\/Table>/gs
  const tableMatches = xmlContent.match(tableRegex)

  if (!tableMatches) {
    return { packages: [], rawData: xmlContent.substring(0, 500) }
  }

  tableMatches.forEach((tableXml) => {
    const getField = (fieldName) => {
      const fieldRegex = new RegExp(`<${fieldName}[^>]*>(.*?)<\/${fieldName}>`, "i")
      const match = tableXml.match(fieldRegex)
      return match ? match[1].trim() : ""
    }

    const packageInfo = {
      trackingNumber: getField("TRACKING"),
      itemNumber: getField("ITEMNO"),
      description: getField("DESCRIPTION"),
      quantity: Number.parseInt(getField("QUANTITY")) || 0,
      packageNumber: getField("PACKAGE"),
    }

    packages.push(packageInfo)
  })

  return { packages, count: packages.length }
}

// Format date from YMMDD to readable format
function formatDate(dateStr) {
  if (!dateStr || dateStr.length < 6) return dateStr

  try {
    // Handle YMMDD format (e.g., 1231225 = 2023-12-25)
    const year = Number.parseInt(dateStr.substring(0, dateStr.length - 4))
    const month = Number.parseInt(dateStr.substring(dateStr.length - 4, dateStr.length - 2))
    const day = Number.parseInt(dateStr.substring(dateStr.length - 2))

    // Add 2000 to year if it's less than 100
    const fullYear = year < 100 ? 2000 + year : year

    const date = new Date(fullYear, month - 1, day)
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch (error) {
    console.error("Error formatting date:", dateStr, error)
    return dateStr
  }
}
