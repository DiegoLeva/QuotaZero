// api/punti-rilievo.js
// CRUD dei Punti Fiduciali aggiunti dall'app (tabella `punti_rilievo`).
// NON è il dataset ufficiale AdE (vedi api/punti-fiduciali.js).
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { bbox } = req.query;
      let where = 'TRUE';
      let params = [];
      if (bbox) {
        const parts = String(bbox).split(',').map(Number);
        if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
          return res.status(400).json({ error: 'bbox non valido. Atteso: west,south,east,north.' });
        }
        where = 'ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography)';
        params = parts;
      }
      const result = await pool.query(
        `SELECT id, comune, seq, nome, lat, lng, created_at
         FROM punti_rilievo WHERE ${where} ORDER BY id LIMIT 2000;`,
        params
      );
      return res.status(200).json({
        count: result.rows.length,
        punti: result.rows.map(r => ({
          id: r.id, comune: r.comune, seq: r.seq, nome: r.nome,
          lat: parseFloat(r.lat), lng: parseFloat(r.lng),
          createdAt: r.created_at
        }))
      });
    }

    if (req.method === 'POST') {
      const { comune, nome, lat, lng } = parseBody(req);
      const la = parseFloat(lat), ln = parseFloat(lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) {
        return res.status(400).json({ error: 'lat/lng mancanti o non validi.' });
      }
      const com = (comune || '').toString().toUpperCase().trim() || null;
      const result = await pool.query(
        `INSERT INTO punti_rilievo (comune, seq, nome, lat, lng, geom)
         SELECT $1,
                COALESCE(MAX(seq), 0) + 1,
                $2, $3, $4,
                ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography
         FROM punti_rilievo
         WHERE comune IS NOT DISTINCT FROM $1
         RETURNING id, comune, seq, nome, lat, lng, created_at;`,
        [com, (nome || '').toString().trim() || null, la, ln]
      );
      const r = result.rows[0];
      return res.status(201).json({
        id: r.id, comune: r.comune, seq: r.seq, nome: r.nome,
        lat: parseFloat(r.lat), lng: parseFloat(r.lng), createdAt: r.created_at
      });
    }

    if (req.method === 'PUT') {
      const { id, nome, lat, lng } = parseBody(req);
      const pid = parseInt(id, 10);
      if (!Number.isInteger(pid)) return res.status(400).json({ error: 'id mancante.' });
      const la = lat == null ? null : parseFloat(lat);
      const ln = lng == null ? null : parseFloat(lng);
      const moving = Number.isFinite(la) && Number.isFinite(ln);
      const result = await pool.query(
        `UPDATE punti_rilievo
            SET nome = $2,
                lat  = COALESCE($3, lat),
                lng  = COALESCE($4, lng),
                geom = CASE WHEN $5 THEN ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography ELSE geom END
          WHERE id = $1
          RETURNING id, comune, seq, nome, lat, lng, created_at;`,
        [pid, (nome || '').toString().trim() || null, moving ? la : null, moving ? ln : null, moving]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Punto non trovato.' });
      const r = result.rows[0];
      return res.status(200).json({
        id: r.id, comune: r.comune, seq: r.seq, nome: r.nome,
        lat: parseFloat(r.lat), lng: parseFloat(r.lng), createdAt: r.created_at
      });
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'id mancante.' });
      const result = await pool.query('DELETE FROM punti_rilievo WHERE id = $1 RETURNING id;', [id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Punto non trovato.' });
      return res.status(200).json({ ok: true, id });
    }

    return res.status(405).json({ error: 'Metodo non supportato.' });
  } catch (error) {
    console.error('Errore Database Neon (punti-rilievo):', error);
    return res.status(500).json({ error: 'Errore interno del server.' });
  }
}
