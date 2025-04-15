exports.handler = async function () {
  return {
    statusCode: 200,
    body: JSON.stringify({ apiKey: process.env.NASA_API_KEY }),
  };
}; 