# AI Development Entry Point

This document is normative for AI coding agents (Codex, Claude Code, etc.) working in this repository.

## Required reading order

1. `docs/README.md` — documentation map and status vocabulary
2. `docs/ai/WORKING_AGREEMENT.md` — work and evidence rules
3. `docs/ai/IMPLEMENTATION_PLAYBOOK.md` — task workflow
4. `docs/product/PRD.md` and `docs/specs/FUNCTIONAL_SPEC.md` — user value and requirements
5. `docs/architecture/SYSTEM_DESIGN.md` and `docs/architecture/ADAPTER_CONTRACT.md` — boundaries and contracts
6. `docs/architecture/SECURITY_PRIVACY.md` — mandatory safety constraints
7. Integration-specific docs, applicable ADRs, tests, and roadmap before coding

## Non-negotiable invariants

- Do not present Grok's model API or a newly-created bot as the same existing **Grok Bot app Bot**.
- A Grok Bot Webhook Routine acknowledging HTTP 200 means a run began; it does NOT mean an answer was delivered. Callback and continuity are unverified.
- Do not claim the Hermes profile's canonical Bot Chat continuity without an end-to-end tested session binding.
- Keep provider-side memory and sessions separate unless the user explicitly authorizes a future opt-in transfer mechanism.
- Screen capture and PC manipulation are separate, opt-in capabilities. Never perform an action on the user's machine without a scoped authorization decision.
- Secrets belong in OS credential storage or an equivalent secured local facility, never in source, logs, or prompts.
- Live2D SDK Core and third-party model assets have separate licenses. Do not commit them without verified rights.
- Never infer implementation from a specification. As of 2026-10-31 an initial vertical slice exists; read `docs/development/IMPLEMENTATION_STATUS.md` for implemented/tested scope and limitations.
- New or changed behavior requires a test/acceptance update and linked evidence.

## Working conventions

Write user-facing documentation in Korean; use English for API symbols, code, protocol keys and paths. Prefer TypeScript, explicit interfaces, stable event schemas, strict validation, and separation of Electron main/preload/renderer. Every external integration must degrade gracefully and expose honest capabilities, availability and errors.

If docs disagree, follow `docs/ai/WORKING_AGREEMENT.md` conflict-resolution rules and raise the conflict in the change description rather than guessing. Read the current repo tree before editing.
