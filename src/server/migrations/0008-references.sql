-- Reference recordings the owner uploads, and the regions marked on them (decision 0050). Both
-- are irreplaceable. A file's bytes are kept at `references/<file>` and never deleted; removing
-- a file marks its row. One live row per SHA-256, so the same bytes twice give one row; the
-- same bytes after a removal give a new row naming the same file.
CREATE TABLE reference_files (
  id INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  fileName TEXT NOT NULL,
  format TEXT NOT NULL,
  file TEXT NOT NULL,
  durationSeconds REAL NOT NULL CHECK (durationSeconds > 0),
  channels INTEGER NOT NULL CHECK (channels IN (1, 2)),
  sampleRate INTEGER NOT NULL CHECK (sampleRate > 0),
  sizeBytes INTEGER NOT NULL CHECK (sizeBytes > 0),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;
CREATE UNIQUE INDEX reference_files_live_sha256 ON reference_files (sha256)
  WHERE removedAt IS NULL;

-- A region's bounds never change: changing a region marks it replaced and adds a row naming it
-- in replacesId.
CREATE TABLE reference_regions (
  id INTEGER PRIMARY KEY,
  referenceFileId INTEGER NOT NULL REFERENCES reference_files (id),
  startSeconds REAL NOT NULL CHECK (startSeconds >= 0),
  endSeconds REAL NOT NULL,
  label TEXT NOT NULL,
  note TEXT NOT NULL,
  replacesId INTEGER REFERENCES reference_regions (id),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK (endSeconds > startSeconds),
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;
CREATE INDEX reference_regions_file ON reference_regions (referenceFileId);
