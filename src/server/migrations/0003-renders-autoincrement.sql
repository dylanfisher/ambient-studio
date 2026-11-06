-- Render ids are never reused (decision 0026). Without AUTOINCREMENT, SQLite gives the highest id
-- back after a delete, so a replaced render's row could take its predecessor's id and a stale
-- `/audio/:renderId` URL would serve other audio. `renders` is derived, so its rows are dropped,
-- not copied: each excerpt renders again on its next request, and the old WAVs in the render
-- cache are left without a row.
DROP TABLE renders;

CREATE TABLE renders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  genomeId INTEGER NOT NULL REFERENCES genomes (id),
  seed INTEGER NOT NULL,
  offset REAL NOT NULL,
  duration REAL NOT NULL,
  target REAL NOT NULL,
  producer TEXT NOT NULL,
  file TEXT NOT NULL,
  features TEXT NOT NULL CHECK (json_valid(features)),
  checks TEXT NOT NULL CHECK (json_valid(checks)),
  createdAt INTEGER NOT NULL,
  UNIQUE (genomeId, seed, offset, duration)
) STRICT;
