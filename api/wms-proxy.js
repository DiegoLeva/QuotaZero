export default async function handler(req, res) {
  // Consenti CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      error: "Parametro 'url' mancante"
    });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const contentType =
      response.headers.get("content-type") || "text/plain";

    const body = await response.text();

    res.setHeader("Content-Type", contentType);

    return res.status(response.status).send(body);

  } catch (error) {
    return res.status(500).json({
      error: "Errore proxy WMS",
      details: error.message
    });
  }
}