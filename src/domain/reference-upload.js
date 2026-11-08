// How the References page sends a file and the server reads it (decision 0050): the raw bytes
// as the body, the file's name percent-encoded in a header, since a header carries only ASCII.

/** The content type of an upload's body. */
export const UPLOAD_TYPE = "application/octet-stream";

/**
 * The header an upload names its file in, as `encodeURIComponent` writes it. A custom header
 * also makes a cross-site fetch need a CORS preflight, which the server never answers (0025).
 */
export const FILE_NAME_HEADER = "x-file-name";
