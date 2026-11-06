-- What a generation sent and got back beyond the answer text, and the parsed genome of a
-- rejected candidate (decision 0024), for phase 8's training sets. Rows written before this
-- migration read null in every new column.

-- The reasoning text a reasoning model streams beside the answer; null when it sent none.
ALTER TABLE generations ADD COLUMN reasoning TEXT;
-- The request body as the queue sent it, without the messages already in `prompt`.
ALTER TABLE generations ADD COLUMN requestParams TEXT CHECK (json_valid(requestParams));
-- The queue's backoffs before the answer or the failure.
ALTER TABLE generations ADD COLUMN retries TEXT CHECK (json_valid(retries));
-- A request that failed in the queue (timeout, busy past the wait, cancel, connection error,
-- an error status) is stored with finishReason 'error', an empty response, and why.
ALTER TABLE generations ADD COLUMN error TEXT CHECK (error IS NULL OR finishReason = 'error');

-- The genome as the answer wrote it, when the candidate was rejected after it parsed.
ALTER TABLE candidates ADD COLUMN rejectedGenome TEXT CHECK (json_valid(rejectedGenome));
