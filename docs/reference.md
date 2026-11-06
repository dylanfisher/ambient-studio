# Reference sources

Where to look things up about the language, the toolchain and the frameworks this project uses,
and which source answers which kind of question. Open only the source a question needs; don't
read these ahead of time. Local sources first: they match the installed versions, and they don't
cost a web fetch.

Cloned sources live in `tmp/docs/`, which git ignores. Run the commands in
[Getting the clones](#getting-the-clones) once per checkout. If `tmp/docs/` is missing, say so
rather than answering from memory.

## Which source to use

| Question | Source | Path |
|---|---|---|
| A Node API: `node:sqlite`, `node:http`, `node:child_process`, streams, `fs` | Node's API docs at the `.nvmrc` version | `tmp/docs/node/doc/api/` (`sqlite.md`, `http.md`, …) |
| How a Web Audio node, `AudioParam` or `OfflineAudioContext` behaves | MDN's Web Audio pages | `tmp/docs/content/files/en-us/web/api/<interface>/` |
| The exact rule the Web Audio spec sets: cycles and delay floors, ramp formulas, convolver normalization, channel mixing | The spec's source | `tmp/docs/web-audio-api/index.bs` |
| What `node-web-audio-api` supports and where it differs from browsers | The installed package's README and source | `node_modules/node-web-audio-api/` (from phase 1) |
| What the renderer under `node-web-audio-api` actually does: threading, determinism, how a node is computed | The Rust crate it wraps, at the version 2.2.0 integrates (v1.7.0) | `tmp/docs/web-audio-api-rs/src/` (`node/`, `render/`, `param.rs`) |
| BS.1770 loudness, gating and true peak, and the EBU Tech 3341 test signals and tolerances | The standards, as PDF and as text to grep | `tmp/docs/loudness/` (`itu-r-bs1770-4`, `-5`, `ebu-tech3341`) |
| The Scala `.scl` tuning file format | The format's page from huygens-fokker.org | `tmp/docs/scala/scl_format.html` |
| A Biome format or lint result from `./scripts/check` | Biome's rule docs (the website has no release tags, so this is its main branch) | `tmp/docs/website/src/content/docs/en/linter/rules/<rule-name>/` |
| A Vitest question | Vitest's docs at the installed version | `tmp/docs/vitest/docs/` (`api/`, `guide/`, `config/`) |
| Where a symbol is defined or used, or what type `tsc` infers for it | The `LSP` tool, served by the `tsgo-lsp` plugin in `.claude/plugins/` (the installed TypeScript's `tsc --lsp`) | any `.js` file; `/reload-plugins` if the tool is missing |
| A knip, jscpd or TypeScript JSDoc question | The installed package's docs and types | `node_modules/<pkg>/` |
| A ruff, pyright or pytest result, or a Python package's API | The installed package in the sidecar venv | `sidecar/.venv/lib/python3.12/site-packages/<pkg>/` |
| Anything not listed (mlx-lm, CLAP) | Web, one page at a time | the package's GitHub README |

Search before reading: `ls` or `grep -ril '<term>'` the folder, then open the one file.

## Getting the clones

Shallow, sparse clones, so only the docs come down. Clones that match an installed version are
pinned to its tag; when the version changes (`.nvmrc`, `package.json`, record 0002), delete that
folder and clone it again at the new tag.

```sh
mkdir -p tmp/docs && cd tmp/docs
clone() { # clone <url> <tag or -> <paths...>
  local dir ref=()
  dir=$(basename "$1" .git)
  [ "$2" != - ] && ref=(--branch "$2")
  git -c advice.detachedHead=false clone -q --depth 1 "${ref[@]}" --filter=blob:none --sparse "$1" &&
    git -C "$dir" sparse-checkout set "${@:3}"
}
clone https://github.com/nodejs/node.git "v$(cat ../../.nvmrc)" doc/api
clone https://github.com/vitest-dev/vitest.git v5.1.0 docs
clone https://github.com/orottier/web-audio-api-rs.git v1.7.0 src
clone https://github.com/WebAudio/web-audio-api.git - images
clone https://github.com/biomejs/website.git - src/content/docs/en/linter src/content/docs/en/formatter \
  src/content/docs/en/reference
web=files/en-us/web/api
clone https://github.com/mdn/content.git - $web/web_audio_api $web/baseaudiocontext \
  $web/offlineaudiocontext $web/audiocontext $web/audionode $web/audioparam $web/audiobuffer \
  $web/audiobuffersourcenode $web/audioscheduledsourcenode $web/oscillatornode $web/periodicwave \
  $web/biquadfilternode $web/gainnode $web/delaynode $web/convolvernode $web/stereopannernode \
  $web/dynamicscompressornode $web/waveshapernode $web/channelsplitternode $web/channelmergernode \
  $web/constantsourcenode

mkdir -p loudness scala
itu=https://www.itu.int/dms_pubrec/itu-r/rec/bs
curl -fsSLo loudness/itu-r-bs1770-4.pdf "$itu/R-REC-BS.1770-4-201510-S!!PDF-E.pdf"
curl -fsSLo loudness/itu-r-bs1770-5.pdf "$itu/R-REC-BS.1770-5-202311-I!!PDF-E.pdf"
curl -fsSLo loudness/ebu-tech3341.pdf https://tech.ebu.ch/docs/tech/tech3341.pdf
for f in loudness/*.pdf; do pdftotext -layout "$f" "${f%.pdf}.txt"; done
curl -fsSLo scala/scl_format.html https://www.huygens-fokker.org/scala/scl_format.html
```

The web-audio-api spec's root files, `index.bs` among them, come with any sparse clone; `images`
is only there to give the checkout a path. BS.1770-4 is the edition record 0008 names; -5
supersedes it and is kept to check what changed.

To update the unpinned clones: `for d in content web-audio-api website; do git -C "tmp/docs/$d" pull -q --depth 1; done`

## Adding a source

Add a row to the table and a line to the block above in the same change. A source belongs here
when it answers questions this project keeps asking and its license allows the clone.
