# Implementation Plan: Science Learning Experience Redesign

**Branch**: `main` (actual checkout; setup script reported feature name `001-science-learning-redesign`) | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-science-learning-redesign/spec.md`

## Summary

Redesign the complete learner and adult web journeys around the Science Field Journal direction, retaining current decks, guest and linked-device entry, quiz scoring, privacy choices and adult management. Build concepts and a shared visual system first, then deliver accessible learner and adult flows against real data. Address save ambiguity and linked-device revocation at the server boundary; do not invent subject metadata, history, progress or explanations. The companion [research-and-proposal.md](research-and-proposal.md) contains the educational research and creative direction.

## Technical Context

**Language/Version**: TypeScript (project dependency `^7.0.2`); React `^19.3.1`, Node-compatible Vite toolchain.<br>
**Primary Dependencies**: Vite 8, React 19, YAML; existing Clerk, Neon, Upstash Redis and Vercel Blob integrations where configured.<br>
**Storage**: Bundled YAML and browser localStorage; in-memory development stores; Redis scores/sessions and Neon accounts/private-deck metadata in configured production; Vercel Blob for files. No question-level durable learning history exists.<br>
**Testing**: Vitest (`npm test`), TypeScript (`npm run typecheck`), production build (`npm run build`), browser and manual assistive-technology QA. Existing repo has no browser-test harness; add focused interaction coverage only where justified.<br>
**Target Platform**: Responsive modern desktop, tablet and mobile browsers.<br>
**Project Type**: React SPA with Vercel serverless API handlers.<br>
**Performance Goals**: Core flows stay responsive during search and answering; no extra blocking request on each interaction absent access checks. Measure real load and interaction against baseline before claiming improvement.<br>
**Constraints**: WCAG 2.2 AA; 320 CSS-pixel reflow and 200% text zoom; keyboard, screen-reader and reduced-motion use; truthful score status and visibility; protect adult/learner access; preserve old deck compatibility and existing private materials.<br>
**Scale/Scope**: Welcome, guest/linked/adult entry, explore, preview, question/feedback, results, profile/device, decks, files and settings; existing library count and account limits, no newly assumed concurrent-user target.

## Constitution Check

**Before Phase 0: PASS with qualification.** `.specify/memory/constitution.md` is an untouched placeholder template, not an adopted constitution; no concrete project principles can be evaluated or inferred. The spec's accessibility, privacy, backwards-compatibility and validation requirements serve as project gates for this plan, not as invented constitutional rules.

**After Phase 1: PASS with the same qualification.** The design uses the existing project and storage patterns, documents the necessary server changes and separates proposed evaluation from measured outcomes. No constitutional violations can be assessed until a constitution is adopted.

## Project Structure

### Documentation (this feature)

```text
specs/001-science-learning-redesign/
├── spec.md
├── research-and-proposal.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── learner-ui.md
│   └── score-and-access.md
└── quickstart.md
```

### Source Code (repository root)

```text
src/
├── App.tsx                   # screen and session orchestration
├── components/              # learner and adult screens
├── deck.ts, library.ts       # deck parsing and accessible library
├── scoreSaver.ts, api.ts     # score queue and client contracts
├── account-shared.ts, auth.tsx
└── styles.css                # visual system and responsive styles
server/                       # session, scoring, access and account handlers/stores
api/                          # HTTP entry points
db/migrations/                # only if persisted schema needs change
decks/                        # existing bundled content
public/                       # shared assets and deck template
```

**Structure Decision**: Extend the existing SPA and services; split presentation into focused components while keeping `App` responsible for existing orchestration. Preserve the established server/store abstraction and its local and production implementations. Avoid new frameworks or history storage unless implementation evidence warrants them.

## Delivery sequence and dependencies

1. **Baseline & concept**: Record the current flows, score/privacy semantics and accessibility findings; create full-screen concept references for library, practice/feedback, results, entry and adult workspace, plus mobile and key states. Derive tokens/components; test representative concepts with users where feasible. The existing prose direction is not a finalized pixel-level concept.
2. **Data and safety foundation**: Add explicit subject metadata only where verified, with legacy/unknown fallback; implement and test unambiguous, idempotent score batches and session/device revalidation as specified in [score-and-access.md](contracts/score-and-access.md). Until completed, represent ambiguous saves as unknown and disable unsafe automatic retry; never show unsupported persistence claims.
3. **Learner slice**: Implement entry, search, preview, quiz, feedback and review with an optional results leaderboard. Preserve question-answer guards, scoring, retries, guest privacy explanation, and focus behavior. Use verified subject if present; searchable titles/descriptions work when absent.
4. **Adult and linked device slice**: Refresh all existing profile, device, private deck, file, settings and account-deletion flows; enforce revocation server-side and cover access changes while studying. Already delivered data cannot be recalled; remove it from the active UI on the next check and explain the boundary.
5. **QA and evaluation**: Run repository checks and meaningful regression tests, plus responsive, visual and accessibility walkthroughs in [quickstart.md](quickstart.md). Compare against concept references and conduct age-cohort research separately; report targets and learning study as unmeasured until completed.

## Risks and decisions

- **Scoring**: A request can commit before a network failure; current retry can double-credit. Batch deduplication and point updates must be atomic in each store, with bounded receipt lifetime. A failure before acknowledgement is “save status unknown,” not automatically “unsaved.”
- **Revocation**: Existing session cookies are not revalidated against revoked linked devices; server-side binding/checking is needed. Refresh assigned deck access at defined boundaries, recognizing offline clients cannot receive instant revocations.
- **Privacy**: Guests are currently publicly ranked when earning points; parent-managed profiles default to unlisted. Hiding the board does not make a guest private. Preserve and explain actual semantics until a separate privacy change is designed and reviewed.
- **Content and progress**: Existing YAML lacks subject and durable question IDs; existing browser best scores are not profile-specific. Never claim personal mastery, saved answers or scheduled review without supporting data and consent.
- **Validation**: The sample sizes and learning targets in the specification are evaluation goals; no actual child usability, accessibility conformance or learning improvement has been established during planning.
