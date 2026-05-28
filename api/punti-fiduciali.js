// api/punti-fiduciali.js
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');

  const { comune } = req.query;

  if (!comune) {
    return res.status(400).json({ error: 'Parametro comune mancante.' });
  }

  try {
    const codComune = String(comune).toUpperCase().trim();

    const query = `
      SELECT
        codice_pf,
        foglio,
        allegato,
        particella,
        descrizione,
        namefile,
        ST_Y(geom::geometry) AS lat,
        ST_X(geom::geometry) AS lng
      FROM punti_fiduciali
      WHERE UPPER(comune) = $1;
    `;

    const result = await pool.query(query, [codComune]);

    return res.status(200).json({
      comune: codComune,
      count: result.rows.length,
      punti: result.rows.map(r => ({
        codice: r.codice_pf,
        foglio: r.foglio,
        allegato: r.allegato,
        particella: r.particella,
        descrizione: r.descrizione,
        namefile: r.namefile,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lng)
      }))
    });

  } catch (error) {
    console.error("Errore Database Neon:", error);
    return res.status(500).json({ error: 'Errore interno del server.' });
  }
}
