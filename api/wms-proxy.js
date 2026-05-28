export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, ...rest } = req.query;
  if (!url) return res.status(400).json({ error: "Parametro 'url' mancante" });

  let target;
  try {
    target = new URL(url);
  } catch {
    return res.status(400).json({ error: "Parametro 'url' non valido" });
  }

  for (const [k, v] of Object.entries(rest)) {
    if (Array.isArray(v)) v.forEach(x => target.searchParams.append(k, x));
    else target.searchParams.set(k, v);
  }

  try {
    const response = await fetch(target.toString(), {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" },
      redirect: "follow"
    });

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    if (contentType.startsWith("image/")) {
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
    }

    if (contentType.startsWith("image/") || /^application\/(octet-stream|pdf)/.test(contentType)) {
      const buf = await response.arrayBuffer();
      return res.status(response.status).send(Buffer.from(buf));
    }

    const body = await response.text();
    return res.status(response.status).send(body);
  } catch (error) {
    return res.status(502).json({
      error: "Errore proxy WMS",
      details: error.message
    });
  }
}
