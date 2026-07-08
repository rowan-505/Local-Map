# V2 implementation checklist (agent workflow)

> Placeholder — expand per phase. Canonical product scope lives in [`AGENTS.md`](../../../AGENTS.md) and [`docs/11-roadmap/v2-plan.md`](../../11-roadmap/v2-plan.md).

## Before starting

- [ ] Read `AGENTS.md` (architecture and non-negotiables).
- [ ] Confirm which V2 phase/step the user requested.
- [ ] Inspect existing modules; reuse patterns before adding new architecture.
- [ ] Scope changes to the requested area only.

## Implementation order (default)

1. Production security foundation
2. National PMTiles and tile package registry
3. Auth + permissions + saved places
4. Contributions + manual admin points
5. Unified search
6. Address system
7. Whole-country Valhalla road routing
8. YBS + express route system
9. Live location sharing

## After implementation

- [ ] Run typecheck/tests appropriate to touched apps.
- [ ] Summarize changed files and test commands.
- [ ] Note unresolved risks or follow-up work.
