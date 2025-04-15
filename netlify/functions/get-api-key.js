exports.handler = async function (event, context) {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*', // Or your specific domain
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type': 'application/json'
  };

  try {
    // Log the environment for debugging
    console.log('Checking for NASA_API_KEY in environment...');
    
    if (!process.env.NASA_API_KEY) {
      console.error('NASA_API_KEY environment variable is not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'NASA_API_KEY environment variable is not set',
          timestamp: new Date().toISOString()
        })
      };
    }
    
    console.log('NASA_API_KEY found, returning response...');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        apiKey: process.env.NASA_API_KEY,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('Error in get-api-key function:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString(),
        type: error.name
      })
    };
  }
}; 