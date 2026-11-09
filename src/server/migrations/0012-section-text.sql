-- The owner's text on every section and transition of a track (decision 0077): each stored
-- revision gains "text": "" on each, its last key, so every key is present as 0061 asks. The
-- append-only triggers are made again after this file, so rewriting the rows here is allowed.
-- Nothing else in an arrangement changes, and text isn't part of a track's recipe, so a
-- revision renders to the same cache key after this as before.
UPDATE track_revisions
   SET arrangement = json_set(
         arrangement,
         '$.sections',
         json((SELECT json_group_array(json_insert(value, '$.text', '') ORDER BY key)
                 FROM json_each(track_revisions.arrangement, '$.sections'))),
         '$.transitions',
         json((SELECT json_group_array(json_insert(value, '$.text', '') ORDER BY key)
                 FROM json_each(track_revisions.arrangement, '$.transitions'))));
