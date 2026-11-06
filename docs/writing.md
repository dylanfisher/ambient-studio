# Writing — comments, docs, commits

Agents copy the prose around them as faithfully as the code. A comment that reads like a riddle
gets imitated by the next file, and a few hundred edits later the whole codebase sounds that way.
Settle the voice early and write it down here, so there is one thing to match.

Change this file to change the voice; don't add a second style guide next to it.

## Voice

Applies to code comments, docstrings, READMEs, `docs/`, and commit bodies.

- **Plain and direct.** Write for a competent teammate new to this code, reading quickly. Short
  sentences, present tense, active voice.
- **Comments say why, not what.** A constraint, an invariant, a workaround and what it works around,
  a consequence that isn't visible from the line itself. If the code already says it, delete the
  comment.
- **Comment density matches the neighbors.** Every export gets JSDoc types (`@param`,
  `@returns`), plus a one-line summary only when the name doesn't already say it. Internals get a
  comment only where a reader would otherwise get it wrong. Python: type hints everywhere, a
  docstring on public functions whose name doesn't say it all.

  ```js
  // Ramp, don't set: an instant jump on a gain AudioParam clicks at audio rate.
  param.linearRampToValueAtTime(target, t + 0.02);
  ```
- **Literal, not literary.** No metaphors, aphorisms, or dramatic framing. "Retries three times
  because the upstream API drops ~1% of requests," not "the gatekeeper stands guard against chaos."
- **No history in the code.** "Added for the billing fix," "now uses X instead of Y," "as discussed"
  — that belongs in the commit message, where it is dated and attached to the diff.
- **Words to avoid:** robust, seamless, leverage, ensure that, it's worth noting, load-bearing,
  crucially, elegantly, simply, delve, tapestry, rich, lush, immersive, sonic landscape,
  comprehensive, powerful, cutting-edge, state-of-the-art, best-in-class. Say the specific thing
  instead: a parameter, a number, a measured result.
- **No throat-clearing lead-ins:** "Note:", "Importantly,", "It's important to", "Keep in mind",
  "This ensures". Start with the fact.
- **Spelling:** US English.

## Commits

Format: [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <summary>

<body>

<footer>
```

| Type | For |
|---|---|
| `feat` | New behavior a user or caller can see |
| `fix` | A bug fix |
| `refactor` | Behavior unchanged, structure changed |
| `perf` | Faster or smaller, behavior unchanged |
| `test` | Tests only |
| `docs` | Documentation only |
| `build` / `ci` | Dependencies, build config, CI |
| `chore` | Anything else that doesn't touch shipped code |

- **Summary:** imperative mood ("add", not "added"), lowercase after the colon, no trailing period,
  72 characters max for the whole title line. It completes the sentence "This commit will…".
- **Scope:** optional. When used, it's a tier from [map.md](map.md): `engine`, `domain`, `config`,
  `server`, `web` or `sidecar`. Not a filename.
- **Body:** required unless the title says everything. Explain why the change was made, what
  alternatives were rejected, and anything a reviewer should look at closely. Don't list the files
  changed — the diff does that. Wrap at 72.
- **Footer:** `Step: <plan step ID>` when the commit implements one, `Refs #123` when there is an
  issue. No AI attribution trailers.
- **One logical change per commit.** Formatting, renames, and tier promotions go in their own
  commit, separate from the work that prompted them.

```
feat(engine): add granular cloud voice

Grains come from an AudioBufferSource per grain, scheduled ahead in
2 s windows, because native nodes can't retrigger one buffer source.
Grain count is capped by the genome's voice budget so an excerpt still
renders 10x faster than real time.

Rejected: one long buffer with gain gating, which can't vary pitch per
grain.

Step: 1c
```

`scripts/commit-msg` checks the title format; `./scripts/setup` installs it.
