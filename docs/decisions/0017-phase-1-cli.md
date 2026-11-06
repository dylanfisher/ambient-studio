# 0017. Phase 1 exposes rendering as a CLI command

- **Date:** 2026-11-05
- **Status:** accepted

## Context

Phase 1 has to render and export before the server, store and UI exist (phase 2). The owner needs
a way to make files to listen to, and phase 2's routes need the same functions.

## Decision

By the owner's choice on 2026-11-05, `./scripts/render` is a thin wrapper that runs a CLI module
in `src/server`:

```
./scripts/render <genome.json> --seed N --duration S --out DIR [--offset S] [--no-flac]
./scripts/render --from <export.json> --out DIR
```

It writes a WAV, a FLAC and the export's sidecar JSON to `DIR`. `--from` re-renders an earlier
export and fails if the samples differ from the hash it recorded. `--out` is required: there is no
config file or app-data folder until phase 2, and a default directory would hide a missing value.
The CLI parses arguments and prints; rendering and export live in `src/server` functions that the
phase 2 routes call unchanged.

## Alternatives considered

- **A minimal HTTP page as well** — rejected as starting server and web work a phase early; the
  owner copies files to mbp2015 to listen in phase 1.
- **A live browser preview in phase 1** — rejected for now; the preview is optional in the spec,
  and the arch check already keeps the engine free of Node imports.

## Consequences

- The CLI module is a knip entry, added to `knip.json` with it.
- An agent running the CLI points `--out` at its scratchpad, never at the owner's data folders.

## Amendments

- 2026-11-06: step 1m builds the CLI (provisional, owner to confirm).
  - **Module.** `src/server/render-cli.js` exports `parseRenderArgs(argv)` and
    `renderCli(argv, print)`, and runs itself when executed; `./scripts/render` execs it without
    changing folder, so relative paths read from where the command was typed. The export's
    loudness target is the genome's `loudness`.
  - **Parser.** `node:util` `parseArgs` in strict mode, so `--flag value` and `--flag=value`
    both work and an unknown option is refused. `--out` is required in both forms. `--seed` is
    a whole number written in digits; `--duration` and `--offset` are digits with an optional
    fraction, no sign or exponent; `--offset` is 0 when omitted. A genome render takes exactly
    one genome file and needs `--seed` and `--duration`; `--from` takes nothing but `--out`.
    A refused command line prints `render: <reason>` and the usage on stderr and exits 2. Any
    other failure (an invalid genome, a taken file name, a re-render that doesn't match) is
    thrown with its stack and exits 1.
  - **Output.** The paths written, one a line (WAV, FLAC, JSON), then one line with the
    integrated loudness and target, the true peak and the gain applied.
  - **`--no-flac`.** `exportRender` takes `flac: false`, which writes no FLAC and leaves `flac`
    out of the sidecar's `files` and of the returned paths. `rerender`, and so `--from`, always
    writes the FLAC.
  - **Loudness oracle.** `scripts/loudness-oracle.js <export.wav>` runs `ffmpeg -nostats -i
    <wav> -af ebur128=peak=true -f null -`, reads the integrated loudness and true peak from the
    summary ffmpeg prints last, reads ours from the sidecar JSON beside the WAV, and prints both
    with the differences against phase 1's ±0.2 LU and ±0.3 dB, exiting 1 when either is
    outside. ffmpeg prints one decimal, so a difference reads to about ±0.05. It reads our
    numbers from the sidecar rather than re-measuring the WAV, so the script needs no WAV
    decoder; the sidecar's values are measured on the samples before 24-bit rounding. Nothing
    in the gate or tests runs it.
  - **Example genomes.** `example.json` and `colundi.json` share their globals (300 s, −16
    LUFS, width −3 dB, fades 4 s and 20 s, reverb decay 8 s, a reverb-level trajectory,
    `brightness` 0.4 and `space` 0.6) and their four voices: a drone, a pad, a pink `wind` noise
    bed and an additive bell whose density trajectory runs 6–11 notes a minute, about 8 on
    average. Levels were set by measuring each voice alone over 30–90 s: in `example.json`
    (D dorian, drone on D at 36.7 Hz) the drone reads −15.0 LUFS, the pad −25.8, the bell −33.7
    and the noise bed −49.3, 34 dB under the drone. `colundi.json` uses `core18`, whose only
    member from 55 to 120 Hz is 105 Hz, so the drone sits on 105 Hz, 10 dB lower than the
    example's (−18 dB) because K-weighting counts 105 Hz far more than 37 Hz; it reads −15.9
    LUFS, the pad −25.7, the bell −35.2, the noise bed −49.3. A genome has one scale, so the
    bell's partials come from `core18`'s members above its fundamental, not from all 128 values;
    drawing from the whole tuning would need a per-voice scale, a schema change. `cost()`:
    311.4 for `example.json`, 320.4 for `colundi.json`, against the budget of 560.
