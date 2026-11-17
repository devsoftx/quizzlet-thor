---
description: "Dependency-ordered tasks for the science learning experience redesign"
---

# Tasks: Science Learning Experience Redesign

**Input**: `specs/001-science-learning-redesign/{spec.md,plan.md,research.md,data-model.md,quickstart.md,contracts/}`

**Organization**: P1 learner practice, returning learners and accessibility precede P2 adult management. The MVP includes the cross-cutting accessibility story, not just the visual learner flow. Tests below cover explicitly specified acceptance, accessibility, scoring and authorization behavior.

## Format: `[ID] [P?] [Story] Description`

- `[P]` indicates a task that can run alongside other marked tasks in the same phase after its stated prerequisites; tasks touching the same file or relying on each other's output are not parallel.
- `[US1]`–`[US4]` map to the user stories in `spec.md`. Paths are repository-relative.

## Phase 1: Setup

**Purpose**: Establish the baseline and a complete visual reference before changing app presentation.

- [X] T001 Record the current guest, linked learner, adult, privacy and save-state flows and baseline findings in `specs/001-science-learning-redesign/baseline.md` using `src/App.tsx`, `src/components/` and the browser.
- [X] T002 Generate and review coordinated complete visual concepts for entry, library, deck preview, practice/feedback, results and adult workspace, including mobile and error states, and save the references and design decisions under `specs/001-science-learning-redesign/concepts/` using `specs/001-science-learning-redesign/research-and-proposal.md`.
- [X] T003 Derive a design inventory for typography, color, contrast, spacing, iconography, components, motion and responsive behavior from T002 and document it in `specs/001-science-learning-redesign/design-system.md`.

## Phase 2: Foundation

**Purpose**: Shared safety and data prerequisites for all learner and adult flows. Complete after setup; preserve existing guest and parent-started sessions during rollout.

- [X] T004 [P] Add regression tests for optional author-supplied subject, old decks, invalid cards and imported/account deck handling in `src/deck.test.ts` and `src/library.test.ts`; enforce “nonempty `cards`”, “at least two distinct options”, “one matching answer”, and missing subject means “uncategorized”.
- [X] T005 [P] Add score API/store tests for identical batch replay, conflicting payload, concurrent duplicates, post-commit response loss, partial failure, expiry and legacy requests in `server/handlers.test.ts`.
- [X] T006 [P] Add linked-session and private-deck authorization tests for device revocation, profile deletion, assignment changes, disabled decks, cross-account IDs and guest/parent regressions in `server/kid-links.test.ts` and `server/library.test.ts`.
- [X] T007 Implement optional validated author-supplied subject parsing in `src/deck.ts` and matching template documentation in `public/deck-template.yaml`; preserve all legacy YAML and never infer a subject from filenames.
- [X] T008 Add case-insensitive title/description search and actual-subject filtering with uncategorized fallback in `src/library.ts`; preserve account assignment filtering and browser-imported/bundled sources.
- [X] T009 Define session-scoped batch IDs, immutable payload fingerprints, bounded receipt lifetime and linked-device session binding in `server/store.ts`; preserve the existing guest and parent-created session contracts.
- [X] T010 Implement atomic score-and-receipt updates in the in-memory and Redis implementations in `server/store.ts`: same ID and payload returns the original receipt, conflicting payload returns 409, and concurrent or failed writes cannot double-credit; retain receipts through session expiry plus the bounded retry window.
- [X] T011 Implement the idempotent score request path and legacy compatibility in `server/handlers.ts` and `api/score.ts`; enforce “boolean-only answers”, the “existing maximum batch size”, streak validation and session authorization, and separate successful scoring from optional leaderboard retrieval.
- [X] T012 Bind linked sessions to verified account/profile/device identity and revalidate the association on session-sensitive requests in `server/handlers.ts`, `server/kid-handlers.ts` and `server/store.ts`; reject revoked devices without changing guest or parent-created behavior.
- [X] T013 Add account-scoped private-deck checks at preview/start and each score batch in `server/library-handlers.ts`, `server/handlers.ts` and the relevant `api/` entry points; reject disabled, unassigned and cross-account decks without exposing their contents.
- [X] T014 Implement stable batch IDs, exact-payload retries and observable queued/in-flight/confirmed/unknown/expired/revoked states in `src/scoreSaver.ts` and `src/api.ts`; do not automatically retry legacy non-idempotent batches or claim keepalive guarantees delivery.
- [ ] T015 Run the T004–T006 regressions against memory stores and isolated production-equivalent Redis/Neon services; record command output and any unavailable environment in `specs/001-science-learning-redesign/validation.md`.

**Checkpoint**: Foundation contracts work or implementation is blocked with the unresolved store/access issue recorded; no UI may claim save or authorization guarantees that are not established.

## Phase 3: User Story 1 — Find and complete a science practice session (P1)

**Goal**: Give a first-time guest an understandable entry, discovery, practice, feedback and review journey.

**Independent test**: A guest reads public nickname disclosure, finds and starts a science deck, answers a correct and incorrect question, views supplied feedback, finishes and retries missed questions without adult help.

- [X] T016 [US1] Redesign guest and adult entry in `src/components/Welcome.tsx`, explaining before nickname submission that guest points appear on the public leaderboard and preserving guest session creation.
- [X] T017 [US1] Rebuild deck discovery in `src/components/DeckList.tsx` with title, actual subject or uncategorized state, question count, search/filter, valid start action, and age-appropriate empty/invalid/disabled states using `src/library.ts`.
- [X] T018 [US1] Add a deck preview with available title, description and count in `src/components/DeckPreview.tsx` and connect it to the screen transitions in `src/App.tsx`; do not invent objectives or resume state.
- [X] T019 [US1] Redesign one-question practice and feedback in `src/components/Quiz.tsx` and `src/components/FlipCard.tsx`, retaining duplicate-answer and duplicate-finish guards, keyboard controls, explicit advance, correct answer and optional author-provided explanation.
- [X] T020 [US1] Redesign results and missed-question retry in `src/components/Results.tsx`; include answer review, a meaningful all-correct state, return to library, and an optional leaderboard independent of score-save success.
- [X] T021 [US1] Integrate batch save state and actionable pending/unknown/failed/expired/confirmed messages into `src/App.tsx` and `src/components/Results.tsx`; report previous confirmed saves separately and never say a timed-out batch is definitely unsaved.
- [ ] T022 [US1] Verify first-time guest discovery, correct/incorrect answers, missing explanation, long text, empty/invalid decks, retry, optional rankings and save recovery as specified in `specs/001-science-learning-redesign/quickstart.md`; record results in `specs/001-science-learning-redesign/validation.md`.

**Checkpoint**: US1 delivers a complete usable guest learning loop; full MVP release also requires US4 accessibility.

## Phase 4: User Story 2 — Return and practice independently (P1)

**Goal**: Make the linked-device and returning-guest journeys clear without implying unsupported history or resume.

**Independent test**: On a linked device, start a learner session, finish a deck, leave and return; verify profile, visibility, session expiry, save state and valid next steps.

- [X] T023 [US2] Redesign linked learner welcome, session start, unlink and expired/invalid invitation states in `src/components/KidScreens.tsx`, using only available profile and point data.
- [X] T024 [US2] Integrate linked-session validation, private-deck access checks and denial handling in `src/App.tsx` and `src/api.ts`; on the next successful server check remove inaccessible deck content from the active UI and explain offline and already-delivered-content limits.
- [X] T025 [US2] Present truthful returning-session and exit states in `src/components/SessionBar.tsx` and `src/App.tsx`; do not label browser-wide best scores as per-child history or claim question progress persists after reload.
- [ ] T026 [US2] Verify linked entry, session expiration, network loss, revocation, disabled/unassigned deck, return and accessible recovery using `specs/001-science-learning-redesign/quickstart.md`; record results in `specs/001-science-learning-redesign/validation.md`.

**Checkpoint**: US2 can be exercised through the existing linked-device setup independently of the redesigned adult screens.

## Phase 5: User Story 4 — Learn accessibly and with appropriate agency (P1)

**Goal**: Ensure the learning loop is navigable, legible and understandable without required motion, sound or competitive ranking.

**Independent test**: Complete the main guest and linked flows with keyboard only and a screen reader, then repeat with 200% zoom and reduced motion.

- [ ] T027 [US4] Apply the T003 design system in `src/styles.css` and shared components under `src/components/`; support 320 CSS-pixel reflow, 200% text zoom, readable long text, contrast, visible focus and adequate target sizes.
- [ ] T028 [US4] Audit and correct accessible names, semantic structure, keyboard behavior and focus order across `src/components/Welcome.tsx`, `src/components/DeckList.tsx`, `src/components/Quiz.tsx`, `src/components/FlipCard.tsx` and `src/components/Results.tsx` so feedback is perceived before advancing.
- [X] T029 [US4] Implement non-disruptive status announcements and text-plus-symbol feedback with reduced-motion alternatives in `src/components/FlipCard.tsx`, `src/components/Results.tsx` and `src/styles.css`; avoid relying on color, sound or animation alone.
- [ ] T030 [US4] Verify keyboard-only, screen-reader, zoom, narrow-screen, reduced-motion, leaderboard-optional and WCAG 2.2 AA behavior across learner flows; document findings and repairs in `specs/001-science-learning-redesign/validation.md`.

**Checkpoint**: US1 plus US4 meets the MVP scope only after the documented accessibility audit passes.

## Phase 6: User Story 3 — Support a learner as an adult (P2)

**Goal**: Refresh the complete parent/teacher workspace while retaining existing management and privacy capabilities.

**Independent test**: A signed-in adult creates a profile, sets visibility, links a device, assigns a private deck, locates files and settings, and revokes the device.

- [X] T031 [P] [US3] Redesign adult workspace navigation and sign-out in `src/components/ParentHome.tsx` while preserving clear separation from learner actions.
- [X] T032 [P] [US3] Redesign profile, visibility, invitation and device controls in `src/components/ProfilesManager.tsx` and `src/components/KidLinks.tsx`; explain public/private effects, expiration and revocation before actions.
- [X] T033 [P] [US3] Redesign private deck and assignment management in `src/components/MyDecks.tsx`, preserving upload, enable/disable, eligible profiles, validation errors and existing authorization.
- [X] T034 [P] [US3] Redesign private file management in `src/components/MyFiles.tsx`, preserving supported uploads, limits, private access, progress and actionable errors.
- [X] T035 [P] [US3] Redesign settings and account deletion in `src/components/Settings.tsx`, preserving confirmation and accurately describing deletion effects.
- [X] T036 [US3] Integrate the adult workspace routes, access checks and updated components in `src/App.tsx`, preserving existing authentication and server-enforced account boundaries.
- [ ] T037 [US3] Verify profile/device/deck/file/settings/account deletion flows with disposable data, including privacy, cross-account denial and failure states, using `specs/001-science-learning-redesign/quickstart.md`; record results in `specs/001-science-learning-redesign/validation.md`.

**Checkpoint**: US3 is independently testable with a signed-in adult and does not require the redesigned learner experience to create profiles or revoke devices.

## Phase 7: Polish and Cross-Cutting Concerns

- [ ] T038 Compare implemented desktop and mobile entry, library, preview, practice, feedback, results and adult states against T002 concepts in the browser; record and fix layout, typography, color, copy, assets and spacing differences in `specs/001-science-learning-redesign/visual-qa.md`.
- [ ] T039 Complete the WCAG 2.2 AA audit across learner and adult screens, including keyboard, screen reader, target size, contrast, 320 CSS-pixel reflow and 200% zoom; record evidence and unresolved failures in `specs/001-science-learning-redesign/validation.md`.
- [ ] T040 Run `npm test`, `npm run typecheck` and `npm run build` and the end-to-end scenarios in `specs/001-science-learning-redesign/quickstart.md`; record actual results in `specs/001-science-learning-redesign/validation.md`.
- [X] T041 Update `README.md` with actual subject metadata, search, entry, leaderboard, save-state and access behavior; document limitations without claiming unavailable review history or guarantees.
- [ ] T042 Prepare and, when participants are available, conduct the cohort usability evaluation described in `specs/001-science-learning-redesign/research-and-proposal.md`; report denominators, consent/assent, outcomes and gaps in `specs/001-science-learning-redesign/usability-results.md` rather than inventing results.
- [ ] T043 Design and, when feasible, run the separate baseline/comparison/delayed-learning evaluation described in `specs/001-science-learning-redesign/research-and-proposal.md`; record methodology, actual results and limitations in `specs/001-science-learning-redesign/learning-evaluation.md` without claiming gains in advance.

## Dependencies & Execution Order

- Phase 1 → Phase 2 → user stories. T002 precedes T003 and all presentation work. T004–T006 may proceed together; T007 → T008, T009 → T010 → T011, T012 → T013, and T011/T013 → T014. T015 verifies the completed foundation.
- US1, US2, US4 and US3 use the shared foundation. US2 can be validated using existing learner screens, and US3 can be validated using existing adult screens. Their integration tasks share `src/App.tsx` and must be serialized. US4 audits the actual US1/US2 screens, so its final verification follows those implementations; its layout and accessibility requirements apply from the start.
- Suggested release MVP: T001–T022 plus T027–T030, with the P1 linked-device story T023–T026 completed before claiming all P1 scope. Any deployed subset must preserve existing adult/linked flows and pass applicable security and accessibility checks.
- Phase 7 follows the relevant implemented journeys. Cohort and learning studies depend on participant availability and must be reported as incomplete if not conducted; they are not substitutes for engineering QA.

## Parallel Execution Examples

- **US1**: After T017 and T018 establish discovery/navigation, T019 (`src/components/Quiz.tsx` and `src/components/FlipCard.tsx`) and T020 (`src/components/Results.tsx`) can be developed independently; serialize T021 because it also changes results integration.
- **US2**: After foundation and an agreed interface, T023 (`src/components/KidScreens.tsx`) can proceed alongside T025 (`src/components/SessionBar.tsx` and `src/App.tsx`); serialize T024 and T025 because both modify `src/App.tsx`.
- **US4**: Accessibility review of the keyboard/focus paths in T028 can be prepared alongside visual responsive review in T027, but implementation edits to shared components and `src/styles.css` must be coordinated and T030 follows both.
- **US3**: T031, T032, T033, T034 and T035 operate on different component files and can proceed concurrently after foundation; T036 integrates them afterward.

## Implementation Strategy

1. Capture baseline and full visual concepts; translate them into a reusable system.
2. Complete and verify the shared score/access foundation, then ship the learner practice slice with US4 accessibility as the MVP.
3. Add the linked learner slice and the adult workspace while preserving the preexisting flows; validate each story with its independent test.
4. Complete visual fidelity, production-equivalent data checks and accessibility audits; conduct child usability and delayed-learning studies as separately scheduled evidence-gathering work.

## Phase 8: Convergence

- [X] T044 Bind queued and in-flight score batches to their originating session in `src/scoreSaver.ts`, `src/App.tsx` and `src/api.ts`; on expiry, sign-out, unlink or identity changes prevent replay or attribution under a new session, preserve an honest unresolved-status notice, and add regression coverage in `src/scoreSaver.test.ts` and `server/handlers.test.ts` per FR-006, FR-012; plan: score identity (contradicts)
- [X] T045 Represent confirmed, pending, rejected, expired and ambiguous saves separately in `src/App.tsx`, `src/scoreSaver.ts` and `src/components/Results.tsx`; clear or update stale library notices after retry and show confirmed versus unresolved work without treating known rejection as a network-unknown outcome per FR-006, US2/AC2, T021 (partial)
- [X] T046 After a private-deck authorization denial, remove or refresh the denied deck from the cached learner library in `src/App.tsx` and `src/api.ts`, preserving already-delivered-content limits and covering linked and parent-started sessions with tests per FR-013; plan: access changes; T024 (partial)
- [X] T047 Carry the active private-deck identity through the empty final score/totals request in `src/scoreSaver.ts` and `src/api.ts`, revalidate authorization in `server/handlers.ts`, and test revocation or unassignment after the last answer but before results per FR-013; plan: access revalidation; T013 (contradicts)
- [X] T048 Handle expiry while a deck preview is open in `src/App.tsx` and `src/components/DeckPreview.tsx`, preventing a new practice round without an active session and offering a clear restart route with regression coverage per US2/AC2; plan: session expiry (partial)
- [X] T049 Correct light-theme session-bar text, timer and urgent-state contrast against the fixed dark background in `src/styles.css`; measure actual foreground/background pairs against WCAG 2.2 AA per FR-010, SC-004 (contradicts)
- [X] T050 Scope the single-character answer shortcuts in `src/components/Quiz.tsx` to an appropriately focused quiz control or provide an accessible disable/remap option, and verify they cannot activate answers from unrelated focused controls per FR-010, US4/AC1; plan: WCAG 2.2 AA (contradicts)
- [X] T051 Finish the replay, conflicting-payload, concurrent duplicate, lost-response, partial-failure, expiry and legacy score regressions in `server/handlers.test.ts` and run reproducible isolated Upstash/Redis and Neon-compatible checks, recording unavailable live transports in `specs/001-science-learning-redesign/validation.md` per T005, T015; plan: atomic score validation (partial)
- [ ] T052 Complete and record guest, linked-device and adult end-to-end checks for network-loss recovery, session expiry, revoked or unassigned access, file management and account-deletion behavior with disposable data in `specs/001-science-learning-redesign/validation.md` per T022, T026, T037, T040 (partial)
- [ ] T053 Complete and document the WCAG 2.2 AA audit across learner and adult flows, including actual screen-reader use, focus order, reduced motion, 320 CSS-pixel reflow, 200% zoom, target sizes and contrast, and repair verified failures in `src/components/` and `src/styles.css` per FR-010, FR-011, SC-004; T027, T028, T030, T039 (partial)
- [ ] T054 Compare each desktop and mobile learner and adult screen with its concept at matching dimensions, resolve or document layout, type, color, copy and artwork differences, and record the evidence in `specs/001-science-learning-redesign/visual-qa.md` per plan: visual verification; T038 (partial)

## Phase 9: Convergence

- [X] T055 Preserve the expired-session state during an in-progress quiz in `src/App.tsx` and `src/scoreSaver.ts`: do not create or submit an unbound score round after expiry, distinguish confirmed from unconfirmed answers, provide a clear restart route, reset save status for a new session, and add regression coverage per FR-006, FR-012, US2/AC2 (contradicts)
- [X] T056 Guard both successful and failed asynchronous private-deck access checks in `src/App.tsx` against session or identity changes so stale denials cannot alter a replacement session, its cached decks, or its screen; cover delayed success and denial in regression tests per FR-013, US2/AC2; plan: access changes (partial)
- [X] T057 Complete linked-device and parent-started private-deck cache-removal regression coverage after authorization denial, and explain the offline and already-delivered-content boundary at an appropriate access-change state in `src/App.tsx` and related learner screens per FR-013; plan: access changes; T046 (partial)
- [X] T058 Add regression coverage for session expiry while preview is open and while a private-deck access check is pending, including the restart route and prevention of a new round per US2/AC2; plan: session expiry; T048 (partial)
- [ ] T059 Complete the learner and adult WCAG 2.2 AA audit, actual screen-reader and keyboard checks, reduced-motion testing, 320 CSS-pixel reflow and 200% zoom checks; repair observed failures and record evidence per FR-010, FR-011, SC-004; T027–T030, T039, T053 (partial)
- [ ] T060 Complete and document disposable-data guest, linked-device and adult end-to-end checks, including save recovery, session expiry, revocation, unassigned decks, file management and account deletion per US1/AC1–AC4, US2/AC1–AC2, US3/AC1–AC3; T022, T026, T037, T040, T052 (partial)
- [ ] T061 Run and document T004–T006 foundation regressions against isolated production-equivalent Redis/Upstash and Neon services, including the actual configured transports, and record unavailable environments without claiming full validation per plan: data and safety foundation; T015 (partial)
- [ ] T062 Compare desktop and mobile learner and adult screens against their matching-size concept references, resolve or document differences, and record visual evidence per plan: baseline and concept, QA and evaluation; T038, T054 (partial)

## Phase 10: Convergence

- [ ] T063 Preserve the expired-session result when a final score flush is invalidated while in flight in `src/App.tsx` and `src/scoreSaver.ts`; show confirmed and unconfirmed points and a restart route instead of an unavailable retry, and add a rendered regression for expiry before the delayed response settles per FR-006, US2/AC2, T055 (contradicts)
- [ ] T064 Isolate a replacement session's score queue from an unresolved prior-session request in `src/scoreSaver.ts` without allowing stale callbacks or cross-session attribution; test that the new session can submit and finish even when the old request never resolves per FR-006, US2/AC2, T044 (partial)
- [ ] T065 Complete and document the WCAG 2.2 AA audit of learner and adult flows, including actual screen-reader use, keyboard focus, contrast, target sizes, reduced motion, 320 CSS-pixel reflow and 200% zoom; repair verified failures per FR-010, FR-011, SC-004; T027–T030, T039, T053, T059 (partial)
- [ ] T066 Complete and record disposable-data end-to-end checks for guest, linked-device and adult journeys, including network-loss recovery, expiry, revocation, unassigned decks, file management and account deletion per US1/AC1–AC4, US2/AC1–AC2, US3/AC1–AC3; T022, T026, T037, T040, T052, T060 (partial)
- [ ] T067 Run and record the foundation regressions against isolated production-equivalent Redis/Upstash and Neon services using their configured transports; document unavailable environments without claiming production validation per plan: data and safety foundation; T015, T061 (partial)
- [ ] T068 Compare desktop and mobile learner and adult screens to their concept references at matching dimensions, resolve or document visual differences, and record evidence per plan: visual verification; T038, T054, T062 (partial)

## Phase 11: Convergence

- [ ] T069 Preserve the expired result and restart route when an in-flight final score save is invalidated, including confirmed versus unconfirmed points and a delayed-response regression in `src/App.tsx` and `src/scoreSaver.ts` per FR-006, US2/AC2, T063 (contradicts)
- [ ] T070 Allow a replacement session to save and finish while a prior session's request remains unresolved, while rejecting stale callbacks and preventing cross-session attribution; cover the never-settling request in `src/scoreSaver.test.ts` per FR-006, US2/AC2, T064 (partial)
- [ ] T071 Complete and document WCAG 2.2 AA, actual screen-reader, keyboard, contrast, target-size, reduced-motion, 320 CSS-pixel reflow and 200% zoom checks for learner and adult flows and repair failures per FR-010, FR-011, SC-004, T065 (partial)
- [ ] T072 Complete and record the remaining disposable guest, linked-device and adult browser end-to-end scenarios, including network loss, expiry, access changes, file management and account deletion per US1/AC1–AC4, US2/AC1–AC2, US3/AC1–AC3, T066 (partial)
- [ ] T073 Run and document foundation regressions through isolated production-equivalent Redis/Upstash and Neon transports, recording unavailable environments without claiming live validation per plan: data foundation, T067 (partial)
- [ ] T074 Compare all required desktop and mobile learner and adult screens to their concepts at matching dimensions, resolve or document discrepancies, and record evidence per plan: visual verification, T068 (partial)
- [ ] T075 When appropriately consented participants are available, conduct the prepared usability and delayed-learning studies and record actual denominators, findings and limitations without inventing results per T042, T043 (partial)
- [X] T076 Repair the accidental shell heredoc text in `specs/001-science-learning-redesign/validation.md`, place the preliminary adult visual comparison in `specs/001-science-learning-redesign/visual-qa.md`, and reconcile the recorded linked-device walkthrough evidence per T038, T039, T040 (partial)
