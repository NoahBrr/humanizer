# Repository guide

The active project in this repository is **AeroOps**, a multi-tenant SaaS
aviation operations platform living entirely in [`aerops/`](./aerops/).

**Read [`aerops/CLAUDE.md`](./aerops/CLAUDE.md) before doing any work** — it
is the project operating system (architecture rules, testing requirements,
do-not-break rules, session instructions).

The engineering-role subagents in `.claude/agents/` here are symlinks to
their canonical definitions in `aerops/.claude/agents/`, so they are
discovered whether a session anchors at the repo root or inside `aerops/`.

Run `npm`/`npx` commands from `aerops/`; run `git` from this root.
