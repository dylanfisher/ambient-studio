-- Whether a development is a bridge (decision 0081): a passage written for the join between two
-- sections, from the owner's words for the join, rather than a development of one section. Every
-- development stored before this is a section's, so the column defaults to 0 for those rows; a
-- new row always gives it. The append-only triggers are made again after this file.
ALTER TABLE developments ADD COLUMN bridge INTEGER NOT NULL DEFAULT 0 CHECK (bridge IN (0, 1));
