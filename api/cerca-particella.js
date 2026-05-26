// api/cerca-particella.js
import { Pool } from 'pg';

// Vercel preleverà DATABASE_URL dalle Environment Variables del tuo pannello di controllo
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } 
});

export default async function handler(req, res) {
  // Configurazione CORS di sicurezza per evitare blocchi del browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { comune, foglio, particella } = req.query;

  if (!comune || !foglio || !particella) {
    return res.status(400).json({ error: 'Parametri mancanti nell\'URL.' });
  }

  try {
    // Trasformiamo i parametri rimuovendo spazi e zeri iniziali per fare il matching corretto
    const fgl = foglio.trim().replace(/^0+/, '');
    const part = particella.trim().replace(/^0+/, '');
    const codComune = comune.toUpperCase().trim();

    // LA QUERY POSTGIS: 
    // ST_AsGeoJSON converte la geometria spaziale in JSON comprensibile da Leaflet
    // ST_Y e ST_X calcolano il punto centrale (centroide) del poligono per spostare la mappa
    const query = `
      SELECT 
        ST_AsGeoJSON(geometry) as geojson,
        ST_Y(ST_Centroid(geometry)) as centro_lat, 
        ST_X(ST_Centroid(geometry)) as centro_lng
      FROM particelle_catastali
      WHERE (UPPER(comune) = $1)
        AND (foglio = $2 OR foglio = $3)
        AND (particella = $4)
      LIMIT 1;
    `;
    
    const result = await pool.query(query, [codComune, fgl, foglio.trim(), part]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Particella non trovata nel database geometrico.' });
    }

    const row = result.rows[0];

    // Risposta JSON strutturata
    return res.status(200).json({
      centro: [parseFloat(row.centro_lat), parseFloat(row.centro_lng)],
      geometria: JSON.parse(row.geojson) 
    });

  } catch (error) {
    console.error("Errore Database Neon:", error);
    return res.status(500).json({ error: 'Errore interno del server durante la query spaziale.' });
  }
}
