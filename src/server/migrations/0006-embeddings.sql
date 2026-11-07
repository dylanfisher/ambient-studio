-- CLAP embeddings (decision 0042), derived: one row per rated audio or render, under the
-- producer that made it, and a row under another producer is replaced. A render's row goes when
-- the render's row is replaced or dropped, since it describes that render's file.
CREATE TABLE embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ratedAudioId INTEGER UNIQUE REFERENCES rated_audio (id),
  renderId INTEGER UNIQUE REFERENCES renders (id) ON DELETE CASCADE,
  producer TEXT NOT NULL,
  vector BLOB NOT NULL,
  createdAt INTEGER NOT NULL,
  CHECK ((ratedAudioId IS NULL) <> (renderId IS NULL))
) STRICT;
