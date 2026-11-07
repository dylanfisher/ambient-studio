-- The session a candidate was made in (decision 0037), so a candidate made without a model
-- request, as a nudge child, is found by its session. Null outside a session, as in an
-- evaluation. Existing rows take their generation's session; the append-only triggers are made
-- again after this file, so the column is as unchangeable as the rest of the row.
ALTER TABLE candidates ADD COLUMN sessionId INTEGER REFERENCES session_events (id);
UPDATE candidates
   SET sessionId = (SELECT g.sessionId FROM generations g WHERE g.id = candidates.generationId)
 WHERE generationId IS NOT NULL;
CREATE INDEX candidates_session ON candidates (sessionId);
