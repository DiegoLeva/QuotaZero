// api/monografia.js
// Risolve al volo l'URL della monografia AdE: la "key" del download e' generata
// server-side per ogni sessione/comune, quindi quella nel GeoJSON e' scaduta.
// Strategia: scrapiamo risultato.php (pubblico, no cookies), troviamo la riga
// con il namefile richiesto, estraiamo key/fs/dir freschi, e redirezioniamo
// l'utente al PDF.

const AE_BASE = "https://www1.agenziaentrate.gov.it/servizi/Monografie";

function escapeRegex(s) {
  return String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { co, foglio, namefile } = req.query;
  if (!co || !foglio || !namefile) {
    return res.status(400).json({ error: "Parametri mancanti: co, foglio, namefile." });
  }

  const resultUrl = `${AE_BASE}/risultato.php?co=${encodeURIComponent(co)}&foglio=${encodeURIComponent(foglio)}`;

  try {
    const r = await fetch(resultUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QuotaZero)" }
    });
    if (!r.ok) throw new Error(`Portale AdE: HTTP ${r.status}`);
    const html = await r.text();

    const escaped = escapeRegex(namefile);
    const regex = new RegExp(
      `download\\.php\\?key=(\\d+)&(?:amp;)?fs=(\\d+)&(?:amp;)?dir=(\\d+)&(?:amp;)?namefile=${escaped}\\b`,
      "i"
    );
    const m = html.match(regex);

    if (!m) {
      return res.redirect(302, resultUrl);
    }

    const [, key, fs, dir] = m;
    const pdfUrl = `${AE_BASE}/download.php?key=${key}&fs=${fs}&dir=${dir}&namefile=${encodeURIComponent(namefile)}`;
    return res.redirect(302, pdfUrl);

  } catch (err) {
    console.error("Errore monografia AdE:", err);
    return res.status(502).json({ error: "Portale Agenzia delle Entrate non raggiungibile." });
  }
}
