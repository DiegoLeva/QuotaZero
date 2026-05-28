// api/cerca-comune.js
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { comune } = req.query;

  if (!comune) {
    return res.status(400).json({ error: 'Parametro comune mancante.' });
  }

  try {
    const codComune = comune.toUpperCase().trim();

    const query = `
      SELECT
        ST_Y(ST_Centroid(ST_Collect(geometry))) as centro_lat,
        ST_X(ST_Centroid(ST_Collect(geometry))) as centro_lng
      FROM particelle_catastali
      WHERE UPPER(comune) = $1;
    `;

    const result = await pool.query(query, [codComune]);

    if (!result.rows.length || result.rows[0].centro_lat === null) {
      return res.status(404).json({ error: 'Comune non trovato nel database geometrico.' });
    }

    const row = result.rows[0];

    return res.status(200).json({
      centro: [parseFloat(row.centro_lat), parseFloat(row.centro_lng)]
    });

  } catch (error) {
    console.error("Errore Database Neon:", error);
    return res.status(500).json({ error: 'Errore interno del server durante la query spaziale.' });
  }
}
