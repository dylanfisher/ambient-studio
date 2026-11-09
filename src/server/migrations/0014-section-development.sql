-- The development each section plays in place of its sketch (decision 0079): each section of
-- every stored revision gains "developmentId": null, its last key, so every key is present as
-- 0061 asks. The append-only triggers are made again after this file, so rewriting the rows
-- here is allowed. Nothing else changes, and a section with no development renders as before,
-- so a revision renders to the same cache key after this as before.
UPDATE track_revisions
   SET arrangement = json_set(
         arrangement,
         '$.sections',
         json((SELECT json_group_array(json_insert(value, '$.developmentId', NULL) ORDER BY key)
                 FROM json_each(track_revisions.arrangement, '$.sections'))));
