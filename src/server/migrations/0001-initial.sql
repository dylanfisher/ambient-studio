-- The phase 2 tables (decision 0021). Times are milliseconds since the Unix epoch. JSON columns
-- are TEXT checked with json_valid. Every table except `renders` is irreplaceable: it carries
-- removedAt and removedReason, and the store adds its append-only triggers after each migration.

CREATE TABLE vibes (
  id INTEGER PRIMARY KEY,
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;

-- One row per edit of a vibe's name, brief, constraints or soft targets; the newest is current.
CREATE TABLE vibe_revisions (
  id INTEGER PRIMARY KEY,
  vibeId INTEGER NOT NULL REFERENCES vibes (id),
  name TEXT NOT NULL,
  brief TEXT NOT NULL,
  constraints TEXT NOT NULL CHECK (json_valid(constraints)),
  softTargets TEXT NOT NULL CHECK (json_valid(softTargets)),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;
CREATE INDEX vibe_revisions_vibe ON vibe_revisions (vibeId);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  vibeId INTEGER NOT NULL REFERENCES vibes (id),
  text TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;
CREATE INDEX notes_vibe ON notes (vibeId);

-- A session is its start row; its stop row names the start row in sessionId.
CREATE TABLE session_events (
  id INTEGER PRIMARY KEY,
  vibeId INTEGER NOT NULL REFERENCES vibes (id),
  kind TEXT NOT NULL CHECK (kind IN ('start', 'stop')),
  sessionId INTEGER REFERENCES session_events (id),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL)),
  CHECK ((kind = 'start') = (sessionId IS NULL))
) STRICT;
CREATE UNIQUE INDEX session_events_one_stop ON session_events (sessionId);

CREATE TABLE generations (
  id INTEGER PRIMARY KEY,
  vibeRevisionId INTEGER NOT NULL REFERENCES vibe_revisions (id),
  sessionId INTEGER REFERENCES session_events (id),
  requestGroup TEXT NOT NULL,
  prompt TEXT NOT NULL CHECK (json_valid(prompt)),
  exampleIds TEXT NOT NULL CHECK (json_valid(exampleIds)),
  retrievalMethod TEXT NOT NULL,
  model TEXT NOT NULL,
  sampling TEXT NOT NULL CHECK (json_valid(sampling)),
  response TEXT NOT NULL,
  finishReason TEXT NOT NULL,
  repairRound INTEGER NOT NULL CHECK (repairRound >= 0),
  repairsId INTEGER REFERENCES generations (id),
  latencyMs REAL NOT NULL,
  firstTokenMs REAL,
  promptTokens INTEGER,
  completionTokens INTEGER,
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL)),
  CHECK ((repairRound = 0) = (repairsId IS NULL))
) STRICT;
CREATE INDEX generations_request_group ON generations (requestGroup);

-- Content only: one row per distinct genome in a vibe (decision 0005).
CREATE TABLE genomes (
  id INTEGER PRIMARY KEY,
  vibeId INTEGER NOT NULL REFERENCES vibes (id),
  genomeHash TEXT NOT NULL,
  genome TEXT NOT NULL CHECK (json_valid(genome)),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL)),
  UNIQUE (vibeId, genomeHash)
) STRICT;

-- Provenance: one row each time a genome was produced, rejected outputs included.
CREATE TABLE candidates (
  id INTEGER PRIMARY KEY,
  vibeRevisionId INTEGER NOT NULL REFERENCES vibe_revisions (id),
  generationId INTEGER REFERENCES generations (id),
  genomeId INTEGER REFERENCES genomes (id),
  seed INTEGER NOT NULL,
  source TEXT NOT NULL,
  parentIds TEXT NOT NULL CHECK (json_valid(parentIds)),
  locks TEXT NOT NULL CHECK (json_valid(locks)),
  operator TEXT,
  operatorParams TEXT CHECK (json_valid(operatorParams)),
  intent TEXT,
  rejectReason TEXT,
  lint TEXT CHECK (json_valid(lint)),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;
CREATE INDEX candidates_genome ON candidates (genomeId);
CREATE INDEX candidates_generation ON candidates (generationId);

-- An excerpt as the owner heard it, kept as FLAC under the rated-audio folder. `file` is
-- relative to that folder; pcmSha256 is of the decoded interleaved 24-bit PCM.
CREATE TABLE rated_audio (
  id INTEGER PRIMARY KEY,
  genomeId INTEGER NOT NULL REFERENCES genomes (id),
  seed INTEGER NOT NULL,
  offset REAL NOT NULL,
  duration REAL NOT NULL,
  engineVersion INTEGER NOT NULL,
  target REAL NOT NULL,
  file TEXT NOT NULL UNIQUE,
  pcmSha256 TEXT NOT NULL,
  gainDb REAL NOT NULL,
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL)),
  UNIQUE (genomeId, seed, offset, duration, engineVersion, target)
) STRICT;

-- An A/B choice. Each side is named by what was heard, never by a renders row. rank, score,
-- modelVersion and wildcard are null until phase 4 writes rankings.
CREATE TABLE ratings (
  id INTEGER PRIMARY KEY,
  sessionId INTEGER NOT NULL REFERENCES session_events (id),
  vibeRevisionId INTEGER NOT NULL REFERENCES vibe_revisions (id),
  aGenomeId INTEGER NOT NULL REFERENCES genomes (id),
  aSeed INTEGER NOT NULL,
  aOffset REAL NOT NULL,
  aDuration REAL NOT NULL,
  aEngineVersion INTEGER NOT NULL,
  aRatedAudioId INTEGER NOT NULL REFERENCES rated_audio (id),
  aPlayedFraction REAL NOT NULL CHECK (aPlayedFraction BETWEEN 0 AND 1),
  aRank INTEGER,
  aScore REAL,
  aModelVersion TEXT,
  aWildcard INTEGER CHECK (aWildcard IN (0, 1)),
  bGenomeId INTEGER NOT NULL REFERENCES genomes (id),
  bSeed INTEGER NOT NULL,
  bOffset REAL NOT NULL,
  bDuration REAL NOT NULL,
  bEngineVersion INTEGER NOT NULL,
  bRatedAudioId INTEGER NOT NULL REFERENCES rated_audio (id),
  bPlayedFraction REAL NOT NULL CHECK (bPlayedFraction BETWEEN 0 AND 1),
  bRank INTEGER,
  bScore REAL,
  bModelVersion TEXT,
  bWildcard INTEGER CHECK (bWildcard IN (0, 1)),
  leftSide TEXT NOT NULL CHECK (leftSide IN ('a', 'b')),
  orderSeed INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('a', 'b', 'tie', 'skip')),
  timeTakenMs REAL NOT NULL,
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;

-- Thumbs (direction up or down, with an optional note) and "more / less like this" on a macro
-- (direction more or less, the macro's name and its effective value over the heard window).
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  sessionId INTEGER NOT NULL REFERENCES session_events (id),
  vibeRevisionId INTEGER NOT NULL REFERENCES vibe_revisions (id),
  kind TEXT NOT NULL CHECK (kind IN ('thumbs', 'macro')),
  direction TEXT NOT NULL,
  note TEXT,
  macro TEXT,
  macroValue TEXT CHECK (json_valid(macroValue)),
  genomeId INTEGER NOT NULL REFERENCES genomes (id),
  seed INTEGER NOT NULL,
  offset REAL NOT NULL,
  duration REAL NOT NULL,
  engineVersion INTEGER NOT NULL,
  ratedAudioId INTEGER NOT NULL REFERENCES rated_audio (id),
  playedFraction REAL NOT NULL CHECK (playedFraction BETWEEN 0 AND 1),
  timeTakenMs REAL NOT NULL,
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL)),
  CHECK (
    (kind = 'thumbs' AND direction IN ('up', 'down') AND macro IS NULL AND macroValue IS NULL)
    OR (kind = 'macro' AND direction IN ('more', 'less') AND macro IS NOT NULL
      AND macroValue IS NOT NULL)
  )
) STRICT;

CREATE TABLE sketches (
  id INTEGER PRIMARY KEY,
  candidateId INTEGER NOT NULL REFERENCES candidates (id),
  notes TEXT NOT NULL,
  tags TEXT NOT NULL CHECK (json_valid(tags)),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;

CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY,
  params TEXT NOT NULL CHECK (json_valid(params)),
  report TEXT NOT NULL CHECK (json_valid(report)),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;

-- Derived: a cached excerpt render. One row per window; a row whose target or producer differs
-- from the caller's is replaced, never returned.
CREATE TABLE renders (
  id INTEGER PRIMARY KEY,
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
