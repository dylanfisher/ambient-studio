-- A reference region's analysis (decision 0051), derived: one row per region and loudness
-- target, holding each window's features under the features' producer, and the region's CLAP
-- embedding under the embedder's producer once it is made. A row under another features
-- producer is replaced; an embedding under another embedder is made again in place.
CREATE TABLE region_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regionId INTEGER NOT NULL REFERENCES reference_regions (id),
  target REAL NOT NULL,
  producer TEXT NOT NULL,
  windows TEXT NOT NULL,
  embeddingProducer TEXT,
  embedding BLOB,
  createdAt INTEGER NOT NULL,
  UNIQUE (regionId, target),
  CHECK ((embeddingProducer IS NULL) = (embedding IS NULL))
) STRICT;
