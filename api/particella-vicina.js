// api/particella-vicina.js
// Restituisce la particella catastale più vicina a un punto (comune/foglio/allegato/particella),
// usata come fallback quando il punto cade fuori da ogni particella.
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Parametri lat/lng mancanti o non validi.' });
  }

  try {
    const result = await pool.query(
      `SELECT comune, foglio, allegato, particella
       FROM particelle_catastali
       ORDER BY geometry <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
       LIMIT 1;`,
      [lng, lat]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Nessuna particella nel database.' });
    const r = result.rows[0];
    return res.status(200).json({
      comune: r.comune || null,
      foglio: r.foglio || null,
      allegato: r.allegato || null,
      particella: r.particella || null
    });
  } catch (error) {
    console.error('Errore Database Neon (particella-vicina):', error);
    return res.status(500).json({ error: 'Errore interno del server.' });
  }
}
