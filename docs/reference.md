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
| A Node API: `node:sqlite`, `node:http`, `node:child_process`, streams, `fs` | Node's API docs | `tmp/docs/node/doc/api/` (`sqlite.md`, `http.md`, …) |
| How a Web Audio node, `AudioParam` or `OfflineAudioContext` behaves | MDN's Web Audio pages | `tmp/docs/content/files/en-us/web/api/<interface>/` |
| What `node-web-audio-api` supports and where it differs from browsers | The installed package's README and source | `node_modules/node-web-audio-api/` (from phase 1) |
| A Biome format or lint result from `./scripts/check` | Biome's rule docs | `tmp/docs/website/src/content/docs/en/linter/rules/<rule-name>/` |
| A Vitest, knip, jscpd or TypeScript JSDoc question | The installed package's docs and types | `node_modules/<pkg>/` |
| A ruff, pyright or pytest result, or a Python package's API | The installed package in the sidecar venv | `sidecar/.venv/lib/python3.12/site-packages/<pkg>/` |
| Anything not cloned (the Web Audio spec, mlx-lm, CLAP) | Web, one page at a time | `webaudio.github.io/web-audio-api/`, the package's GitHub README |

Search before reading: `ls` or `grep -ril '<term>'` the folder, then open the one file.

## Getting the clones

Shallow, sparse clones, so only the docs come down.

```sh
mkdir -p tmp/docs && cd tmp/docs
clone() {
  git clone -q --depth 1 --filter=blob:none --sparse "$1" "$(basename "$1" .git)" &&
    git -C "$(basename "$1" .git)" sparse-checkout set "${@:2}"
}
clone https://github.com/nodejs/node.git doc/api
clone https://github.com/biomejs/website.git src/content/docs/en/linter src/content/docs/en/formatter \
  src/content/docs/en/reference
web=files/en-us/web/api
clone https://github.com/mdn/content.git $web/web_audio_api $web/baseaudiocontext \
  $web/offlineaudiocontext $web/audiocontext $web/audionode $web/audioparam $web/audiobuffer \
  $web/audiobuffersourcenode $web/oscillatornode $web/periodicwave $web/biquadfilternode \
  $web/gainnode $web/delaynode $web/convolvernode $web/stereopannernode \
  $web/dynamicscompressornode $web/waveshapernode
```

To update them all: `for d in tmp/docs/*/; do git -C "$d" pull -q --depth 1; done`

## Adding a source

Add a row to the table and a line to the clone block in the same change. A source belongs here
when it answers questions this project keeps asking and its license allows the clone.
