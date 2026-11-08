-- What the owner attaches to a vibe beside its revisions (decision 0052): reference regions now,
-- and the directions (5g) and axes (5h) the plan names, each in `details` as JSON, so those steps
-- add rows of their kind without another migration. Irreplaceable: detaching marks the row
-- removed, and attaching again adds a new row. Changing an attachment makes no new revision.
CREATE TABLE vibe_attachments (
  id INTEGER PRIMARY KEY,
  vibeId INTEGER NOT NULL REFERENCES vibes (id),
  kind TEXT NOT NULL CHECK (kind IN ('reference', 'direction', 'axis')),
  -- The region a reference names; 5h's axis on similarity to a region may name one too.
  regionId INTEGER REFERENCES reference_regions (id),
  details TEXT NOT NULL CHECK (json_valid(details)),
  createdAt INTEGER NOT NULL,
  removedAt INTEGER,
  removedReason TEXT,
  CHECK ((removedAt IS NULL) = (removedReason IS NULL)),
  CHECK (kind <> 'reference' OR regionId IS NOT NULL)
) STRICT;
CREATE INDEX vibe_attachments_vibe ON vibe_attachments (vibeId);
-- A region is attached to a vibe at most once at a time.
CREATE UNIQUE INDEX vibe_attachments_one_reference ON vibe_attachments (vibeId, regionId)
  WHERE removedAt IS NULL AND kind = 'reference';

-- The attachments each generation's prompt held, as a JSON list of vibe_attachments ids, as
-- exampleIds lists its examples. Rows from before this migration held none.
ALTER TABLE generations ADD COLUMN attachmentIds TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(attachmentIds));
