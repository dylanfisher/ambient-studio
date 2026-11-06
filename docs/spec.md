# Project: Ambient Studio: prototype ambient soundscapes by tuning a generative engine to a vibe

## What it is
A local studio app for prototyping ambient music. I describe a **vibe**: a brief plus hard constraints,
for example "cold, tidal, slow; D dorian; no percussion; 60–90 s swells; −20 LUFS". A local LLM proposes
**genomes**: JSON parameter sets for a generative engine I own. I listen, rate, lock what works and
let the system explore what doesn't. Its suggestions converge on that vibe.

Good results become **sketches**. I arrange sketches into **tracks**, and tracks into **albums** that
explore one vibe with coherent variation. Then I export finished audio.

Sessions are on demand: I start a session, work, and stop. In this iteration nothing generates in the
background. The learning loop exists so that each session, and each vibe, gets better from my
feedback.

## Machines and constraints
- **mbp2021** (M1 Max, 64 GB, macOS): runs everything: the server, rendering, the taste models and
  training.
- **mbp2015** (2015 Intel MacBook Pro, macOS 12) and **mbp2026**: I use the studio UI from these
  over the LAN. Serve by LAN IP (not `.local`).
  - Default to playing server-rendered audio. Live in-browser preview is optional.
- **The LLM is omlx** at `http://127.0.0.1:8000` (OpenAI-compatible). It is shared with a live public
  site:
  - at most 1 request in flight
  - back off when the other site is busy
  - never change omlx settings, load models or swap models
  - the model id comes from config
- **Training (LoRA)** competes with the live site. It runs only when I start it, using a separate
  small model and never the omlx instance.
- **Stack:** Node (ESM) server, SQLite (WAL), plain HTML/CSS/JS frontend (no build step if possible),
  and a Python sidecar only where the ML ecosystem requires one (CLAP embeddings, preference models,
  optimizers, mlx-lm).

## Core concepts
- **Vibe:** a project. It holds:
  - a text brief and reference notes
  - optional reference audio (embedded with CLAP, never trained on)
  - **hard constraints** the linter enforces: key or mode, tuning, tempo or pulse (or none), duration
    range, loudness target, voice types allowed or banned, density ceilings, brightness range, and so
    on
  - **soft targets** the scorer rewards: CLAP text directions, feature ranges
  - its own preference model and history
- **Genome:** a versioned, schema-validated JSON parameter set: voices, global settings, and parameter
  *trajectories* over time. It is deterministic given a seed.
- **Sketch:** a saved genome plus seed that I liked, with notes and tags.
- **Track:** an arrangement of one or more sketches on a timeline. It has sections, transitions,
  automation of macro parameters across the track, and a target length (3–20 min).
- **Album:** an ordered set of tracks with shared constraints from the vibe. It has an arc (energy,
  brightness and density over the running order), key relationships between tracks, transitions or
  gaps, and a cohesion and variety balance.

## The engine
- One module, `engine.js`, written against the Web Audio API.
  - Renders offline in Node via `node-web-audio-api` (`OfflineAudioContext`), at least 10× faster than
    real time.
  - The same code can optionally preview live in a browser.
  - `render(genome, ctx, {seed, duration})` is deterministic.
- v1 uses native nodes only (no AudioWorklets): oscillators, BiquadFilter, Gain, Delay, Convolver
  (generated impulse responses), StereoPanner, AudioBufferSource.
- Voice types:
  - drone (detuned stacks, slow filter sweeps)
  - pad / swell (ADSR envelopes, chords from the scale or mode)
  - granular cloud (density, grain size, pitch spread, buffer source)
  - sparse bells / plucks (FM or Karplus-Strong, probabilistic triggers)
  - noise beds (wind, rain, surf, filtered noise)
  - optional sample layer from a local folder of my field recordings
- Global settings: key, scale or mode, tuning (12-TET, just intonation, custom cents), pulse (often
  none), master reverb and delay, stereo width, loudness target.
- **Macro controls:** a small set of high-level knobs mapped onto many parameters: brightness,
  density, motion, depth/space, warmth, tension. The vibe, track automation and optimizers work mostly
  on these macros, which keeps the search space small.
- **Export:**
  - WAV (48 kHz / 24-bit) and FLAC
  - optional per-voice stems
  - loudness-normalized to the vibe target, with a true-peak limiter
  - each export comes with a sidecar JSON (genome, seed, engine version) so I can re-render it
    exactly

## Generate → listen → steer loop (one session)
1. I open a vibe and ask for N candidates (default 8).
2. The LLM gets:
   - the brief, the constraints and the genome schema
   - my notes
   - liked and disliked sketches from this vibe, retrieved by CLAP similarity
   - the current locks
3. It writes genomes. Invalid output gets one repair round, with the validation errors fed back.
4. **Lint and checks:** constraint violations, clipping, near-silence, DC offset, CPU or voice
   budget.
5. **Render 20–30 s excerpts**, then compute features and a CLAP embedding.
6. **"Ears":** measured features go back to the LLM as text ("−23 LUFS, centroid 3.1 kHz — too bright
   for this vibe; 2.4 onsets/s — too busy"). It can revise once before I hear anything.
7. The vibe's preference model ranks the candidates. I hear the top ones, with the rest one click
   away.
8. I rate, in a choice of ways:
   - **A/B:** pick a winner or call it a tie
   - **thumbs** up or down, with an optional note
   - **"more like this / less like this"** for a parameter or macro
   - **lock** parameters or voices, then **explore** the rest
   - **branch** a variation
9. The next round uses everything from this session.
   - **Show the lineage:** every candidate keeps its parents, so I can see a tree of variations and
     return to any branch.

## Learning and tuning (the core of the project)
1. **In-context memory:** per-vibe examples, notes and dislikes go into the prompt. Works from day 1.
2. **Preference models:**
   - Per vibe, plus a weaker global "my taste" prior.
   - Bradley–Terry on pairwise choices and thumbs, over CLAP embeddings, engine features and macro
     values.
   - Uncertainty via an ensemble or bootstrap.
   - Used for:
     - reranking candidates (best-of-N)
     - **active learning**: show me the pairs the model is least sure about
     - reporting what the model thinks I like for this vibe ("prefers density < 0.3, long reverb
       tails, no bells")
3. **Parameter optimization inside the constraints:**
   - Preference-based Bayesian optimization or CMA-ES over the macros, plus selected raw parameters,
     respecting locks.
   - Mostly within one vibe; the LLM provides structural jumps (new voices, different forms).
   - **MAP-Elites** archive per vibe on two or three axes I choose (for example dark↔bright ×
     static↔evolving). I click a cell to hear it. This is the main tool for finding album-worthy
     variety within one vibe.
4. **Breeding:** I pick 2 sketches, and the system makes children by LLM crossover plus programmatic
   mutation.
5. **CLAP steering:**
   - Typed directions ("more underwater", "less melodic") become vectors; each gets a slider.
   - Reference audio becomes a target region in embedding space.
6. **LLM fine-tuning** (later phase, only when I start it; mlx-lm LoRA on a separate small model):
   - Supervised fine-tuning on sketches I kept, across vibes, to get better first drafts.
   - DPO on my pairwise choices.
   - Optionally, GRPO with the preference model as reward.
   - Every adapter is versioned and evaluated against the previous one in blind A/B pairs.

## From sketches to tracks and albums
- **Track builder:**
  - Place sketches into sections on a timeline.
  - Transitions: crossfade, or morph by interpolating genomes over time.
  - Macro automation curves across the track.
  - An LLM can propose a structure for a target length and arc ("10 min: emerge, plateau, dissolve").
  - Render the full track offline.
- **Album builder:**
  - Order tracks; set an arc for energy, brightness and density over the album.
  - Key relationships between tracks.
  - Variety pressure: each new track should differ from the others in CLAP space and features while
    staying inside the vibe's constraints. Show a cohesion and variety readout.
  - Generate missing tracks to fill gaps in the arc, using the MAP-Elites archive and the optimizer.
  - Export the album as files, plus a manifest with the track list, durations and re-render info.

## UI (plain web, keyboard friendly, works on older browsers)
- **Vibe page:** brief, constraints, soft targets, notes, reference audio, preference-model summary.
- **Session view:** candidate grid with audio players, feature readouts, the model's one-line intent
  and rating controls. Locks and the explore button. Lineage tree.
- **A/B view:** focused pairwise comparison.
- **Map view:** the MAP-Elites grid.
- **Track and album builders.**
- **Exports list.**

## Data (SQLite; append-only, mark rows removed instead of deleting)
- `vibes`: brief, constraints JSON, soft targets, notes
- `genomes`
  - id, vibe id, parent ids
  - source: llm | mutation | crossover | optimizer | breeding
  - model or adapter id, schema and engine version, JSON
- `renders`
  - genome id, seed, duration, kind (excerpt | full | stem), file path
  - features JSON, CLAP embedding, check results
- `ratings`: pairwise (a, b, winner | tie), thumbs, directional feedback, notes, session id
- `sketches`, `tracks` (arrangement JSON), `albums` (ordering and arc JSON), `exports`
- `pref_models`: per vibe, versioned, with metrics
- `training_runs`: adapter, dataset, metrics, A/B result

## Risks to design for
- **Reward hacking or collapse:**
  - The linter enforces the vibe constraints, plus floors such as no near-silence and no lone static
    drone.
  - Diversity pressure, so the system doesn't collapse to one safe drone.
  - Periodically show "wildcard" candidates from outside the model's favorites.
- **Rating fatigue:** short excerpts, A/B and thumbs rather than scalar ratings, active learning.
- **Load on the live site:** strict low priority on omlx, no long contexts, training only on request.
- **Reproducibility:** every render comes from genome + seed + engine version. Version the engine so
  old sketches re-render the same way, or warn when they wouldn't.

## Build order and acceptance criteria
1. **Engine, schema and macros:**
   - Offline Node render of an example genome to WAV, at least 10× faster than real time.
   - Export with loudness normalization and the sidecar JSON.
2. **Vibe and session loop:**
   - The LLM generates at least 90% valid genomes after one repair round.
   - Constraints are linted.
   - The candidate grid plays from mbp2015.
   - Thumbs, A/B and notes are stored.
3. **Ears and steering:**
   - Feature feedback lets the model revise before I listen.
   - Locks and explore.
   - Lineage tree.
4. **Preference model:**
   - CLAP sidecar, per-vibe Bradley–Terry plus uncertainty, reranking, active-learning pairs.
   - Report held-out pairwise agreement and the "what you like" summary.
5. **Optimizers:**
   - BO or CMA-ES over macros, respecting locks.
   - MAP-Elites map view.
   - Breeding.
   - CLAP text sliders and reference-audio targets.
6. **Track builder:**
   - Sections, crossfade and morph transitions, macro automation, LLM-proposed structure.
   - Full-track render and stems.
7. **Album builder:** ordering, arc, key relationships, cohesion and variety readout, gap filling,
   album export.
8. **Fine-tuning:** mlx-lm LoRA supervised fine-tuning and DPO on a separate small model, with blind
   A/B evaluation against the baseline.

## Non-goals (this iteration)
- Background or endless generation.
- Training audio-native models.
- A hybrid where an audio model renders textures for the engine to granulate is a possible later
  phase.
- Multi-user use.
- Mobile apps.
- Custom AudioWorklet voices; a sandboxed custom-voice escape hatch is a later phase.
