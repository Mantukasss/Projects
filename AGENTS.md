# Shared agent instructions

`CLAUDE.md` is the canonical instruction and handoff file for every coding agent working in
this repo. Do not create a separate per-agent context or handoff trail.

Before changing this repository:

1. Read the entire root `CLAUDE.md`.
2. Read the entire `apps/<name>/CLAUDE.md` for every app you will touch.
3. Inspect the current branch, working tree, and recent commits so you continue existing
   work instead of replacing it.

Follow the multi-agent workflow in root `CLAUDE.md`. In the same change as the code,
update the affected app's `Current state` and `Next` sections, including the shared
`Handoff:` line when work is in flight. Leave every pushed commit as a clean resume point
for the next agent, and never push directly to `main` without confirmation.
