-- The owner hiding and showing again a candidate on the session page (decision 0049). One row
-- per hide or unhide, never changed: a candidate is hidden when its newest row says so, and
-- unhiding appends a row rather than removing one, so the history stays. Irreplaceable, as the
-- owner's choice; removedAt and removedReason are there because every irreplaceable table has
-- them, and nothing sets them.
CREATE TABLE candidate_hides (
  id INTEGER PRIMARY KEY,
  candidateId INTEGER NOT NULL REFERENCES candidates (id),
  hidden INTEGER NOT NULL CHECK (hidden IN (0, 1)),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL))
) STRICT;
CREATE INDEX candidate_hides_candidate ON candidate_hides (candidateId);
