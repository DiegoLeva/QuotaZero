-- Tabella per i Punti Fiduciali aggiunti manualmente dall'app QuotaZero.
-- NON va confusa con `punti_fiduciali` (dataset ufficiale AdE, sola lettura).
-- Eseguire una volta nella console Neon prima del deploy.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS punti_rilievo (
  id          SERIAL PRIMARY KEY,
  comune      TEXT,                                  -- codice Belfiore (es. D810), per la numerazione sequenziale
  seq         INTEGER NOT NULL,                      -- progressivo del PF per quel comune (solo punti nostri)
  nome        TEXT,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  geom        geography(Point, 4326),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS punti_rilievo_geom_idx   ON punti_rilievo USING GIST (geom);
CREATE INDEX IF NOT EXISTS punti_rilievo_comune_idx ON punti_rilievo (comune);
