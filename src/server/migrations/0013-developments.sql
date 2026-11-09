-- A track's developments of its sketches (decision 0079): the genome the model wrote for one
-- section from the sketch, the owner's words and the section's neighbors. Irreplaceable: a
-- development belongs to its track, never becomes a sketch or a candidate, and is removed by
-- mark. `offset` is where the section started on the sketch's timeline when it was developed,
-- so going back to the plain sketch puts it there again; `seconds` is the length asked for and
-- the genome's duration. `seed` is the sketch's candidate's, so voices that continue play the
-- sketch's events. `generationId` is the answer it was taken from, the repair's when there was
-- one.
CREATE TABLE developments (
  id INTEGER PRIMARY KEY,
  trackId INTEGER NOT NULL REFERENCES tracks (id),
  sketchId INTEGER NOT NULL REFERENCES sketches (id),
  text TEXT NOT NULL,
  offset REAL NOT NULL CHECK (offset >= 0),
  seconds REAL NOT NULL CHECK (seconds > 0),
  genomeId INTEGER NOT NULL REFERENCES genomes (id),
  seed INTEGER NOT NULL,
  generationId INTEGER NOT NULL REFERENCES generations (id),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;
CREATE INDEX developments_track ON developments (trackId);
