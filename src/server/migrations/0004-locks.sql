-- A vibe's locks (decision 0035): values the owner locked from a candidate, which every genome
-- later made in the vibe keeps. Irreplaceable: a removed lock is marked removed, as "unlocked",
-- "replaced" by a new lock on its path, or "covered" by a lock on its whole voice.
CREATE TABLE locks (
  id INTEGER PRIMARY KEY,
  vibeId INTEGER NOT NULL REFERENCES vibes (id),
  -- The candidate the value was taken from.
  candidateId INTEGER NOT NULL REFERENCES candidates (id),
  path TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  -- The voice's type, exactly when the path is a voice's parameter.
  voiceType TEXT,
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL)),
  CHECK ((voiceType IS NOT NULL) = (path LIKE 'voices.%.%'))
) STRICT;
CREATE INDEX locks_vibe ON locks (vibeId);
-- One live lock per path in a vibe.
CREATE UNIQUE INDEX locks_one_live ON locks (vibeId, path) WHERE removedAt IS NULL;
