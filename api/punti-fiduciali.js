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

  const { comune, bbox } = req.query;

  if (!comune && !bbox) {
    return res.status(400).json({ error: 'Specificare ?comune=... oppure ?bbox=west,south,east,north.' });
  }

  try {
    let where;
    let params;

    if (bbox) {
      const parts = String(bbox).split(",").map(Number);
      if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
        return res.status(400).json({ error: 'bbox non valido. Atteso: west,south,east,north.' });
      }
      const [w, s, e, n] = parts;
      where = `ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography)`;
      params = [w, s, e, n];
    } else {
      where = `UPPER(comune) = $1`;
      params = [String(comune).toUpperCase().trim()];
    }

    const query = `
      SELECT
        codice_pf,
        comune,
        foglio,
        allegato,
        particella,
        descrizione,
        namefile,
        ST_Y(geom::geometry) AS lat,
        ST_X(geom::geometry) AS lng
      FROM punti_fiduciali
      WHERE ${where}
      LIMIT 2000;
    `;

    const result = await pool.query(query, params);

    return res.status(200).json({
      count: result.rows.length,
      punti: result.rows.map(r => ({
        codice: r.codice_pf,
        comune: r.comune,
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
