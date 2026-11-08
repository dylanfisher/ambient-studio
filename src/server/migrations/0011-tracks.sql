-- Tracks (decision 0061): sketches of one vibe arranged on a timeline. All three tables are
-- irreplaceable. A track is its identity and name; every edit of its arrangement appends a
-- revision, the newest current, as a vibe's revisions do. An export row logs a folder written
-- under the data root's exports/ from one revision (6c and 6d write them).
CREATE TABLE tracks (
  id INTEGER PRIMARY KEY,
  vibeId INTEGER NOT NULL REFERENCES vibes (id),
  name TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;
CREATE INDEX tracks_vibe ON tracks (vibeId);

-- The arrangement is checked by validateArrangement before it is stored.
CREATE TABLE track_revisions (
  id INTEGER PRIMARY KEY,
  trackId INTEGER NOT NULL REFERENCES tracks (id),
  arrangement TEXT NOT NULL CHECK (json_valid(arrangement)),
  note TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;
CREATE INDEX track_revisions_track ON track_revisions (trackId);

-- `kind` is the mix (6c) or its stems (6d); `folder` is relative to exports/.
CREATE TABLE track_exports (
  id INTEGER PRIMARY KEY,
  trackRevisionId INTEGER NOT NULL REFERENCES track_revisions (id),
  kind TEXT NOT NULL CHECK (kind IN ('mix', 'stems')),
  folder TEXT NOT NULL,
  manifestSha256 TEXT NOT NULL CHECK (length(manifestSha256) = 64),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;
CREATE INDEX track_exports_revision ON track_exports (trackRevisionId);
