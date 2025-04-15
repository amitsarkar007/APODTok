exports.handler = async function () {
  try {
    if (!process.env.NASA_API_KEY) {
      throw new Error('NASA_API_KEY environment variable is not set');
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ apiKey: process.env.NASA_API_KEY }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
}; 