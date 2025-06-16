const axios = require("axios");
const https = require("https");

exports.handler = async function (event, context) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      },
      body: "",
    };
  }

  // Parse request body to get pagination parameters
  const { 
    lastUpdate = "1/1/1990", 
    lastItem = -1, 
    pageSize = 10,
    page = 1 
  } = JSON.parse(event.body || "{}");

  // Calculate the actual lastItem for pagination
  // For first page (page=1), use lastItem = -1
  // For subsequent pages, calculate based on page number and pageSize
  const calculatedLastItem = page === 1 ? -1 : (page - 1) * pageSize - 1;

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
        <LastItem>${calculatedLastItem}</LastItem>
        <Source>FPR</Source>
      </DailyItemUpdate>
    </soap:Body>
  </soap:Envelope>`;

  try {
    const response = await axios.post(
      "http://webservices.theshootingwarehouse.com/smart/inventory.asmx",
      soapBody,
      {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "http://webservices.theshootingwarehouse.com/smart/Inventory.asmx/DailyItemUpdate",
        },
      }
    );

    // Extract and parse the XML data
    const extractDataFromSoapXml = (xmlString) => {
      try {
        const parser = require('xml2js');
        return new Promise((resolve, reject) => {
          parser.parseString(xmlString, (err, result) => {
            if (err) {
              reject(err);
              return;
            }
            
            try {
              // Navigate through the SOAP response structure
              const soapBody = result['soap:Envelope']['soap:Body'][0];
              const updateResponse = soapBody['DailyItemUpdateResponse'][0];
              const updateResult = updateResponse['DailyItemUpdateResult'][0];
              
              // Parse the inner XML data
              parser.parseString(updateResult, (innerErr, innerResult) => {
                if (innerErr) {
                  reject(innerErr);
                  return;
                }
                
                const tables = innerResult?.NewDataSet?.Table || [];
                const items = tables.map(table => ({
                  ITEMNO: table.ITEMNO?.[0] || '',
                  IDESC: table.IDESC?.[0] || '',
                  ITUPC: table.ITUPC?.[0] || '',
                  PRC1: table.PRC1?.[0] || '0',
                  QTYOH: table.QTYOH?.[0] || '0',
                  CATEGORY: table.CATEGORY?.[0] || 'Uncategorized',
                  MANUFACTURER: table.MANUFACTURER?.[0] || 'Unknown',
                  WEIGHT: table.WEIGHT?.[0] || '0',
                  CALIBER: table.CALIBER?.[0] || '',
                  BARREL_LENGTH: table.BARREL_LENGTH?.[0] || '',
                  ACTION_TYPE: table.ACTION_TYPE?.[0] || ''
                }));
                
                resolve(items);
              });
            } catch (parseError) {
              reject(parseError);
            }
          });
        });
      } catch (error) {
        throw error;
      }
    };

    // For now, we'll use a simpler extraction method since xml2js might not be available
    // This is a fallback that mimics the original extraction logic
    const extractDataSimple = (xmlString) => {
      try {
        // Simple regex-based extraction for demo purposes
        // In production, you'd want to use a proper XML parser
        const tableMatches = xmlString.match(/<Table[^>]*>[\s\S]*?<\/Table>/g) || [];
        
        return tableMatches.slice(0, pageSize).map(tableXml => {
          const getValue = (tag) => {
            const match = tableXml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
            return match ? match[1].trim() : '';
          };
          
          return {
            ITEMNO: getValue('ITEMNO'),
            IDESC: getValue('IDESC'),
            ITUPC: getValue('ITUPC'),
            PRC1: getValue('PRC1'),
            QTYOH: getValue('QTYOH'),
            CATEGORY: getValue('CATEGORY') || 'Firearms',
            MANUFACTURER: getValue('MANUFACTURER') || 'Various',
            WEIGHT: getValue('WEIGHT') || '0',
            CALIBER: getValue('CALIBER') || '',
            BARREL_LENGTH: getValue('BARREL_LENGTH') || '',
            ACTION_TYPE: getValue('ACTION_TYPE') || ''
          };
        });
      } catch (error) {
        console.error('Error extracting data:', error);
        return [];
      }
    };

    const items = extractDataSimple(response.data);
    
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
        hasMore: items.length === pageSize, // Assume there are more if we got a full page
        totalFetched: items.length
      }),
    };
  } catch (error) {
    console.error('SOAP request error:', error);
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
    };
  }
};
