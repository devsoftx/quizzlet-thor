# Validation log

## Foundation checkpoint — 2026-11-16

- Baseline before changes: `npm test` passed 105 tests in 8 files.
- After local changes: `npm test` and `npm run build` pass; see latest run for current counts. Unit and integration coverage includes legacy decks, explicit subject, duplicate score replay/conflict, ambiguous client response, revoked linked session and private deck assignment.
- An isolated `redis:7.4.2-alpine` container with networking disabled ran the exact Lua script extracted from `server/store.ts`. Eight concurrent identical batches returned the same receipt and incremented totals once; changed payload returned conflict; a deliberately invalid Redis key type returned an error before changing scores. This validates these scenarios against Redis itself, not the Upstash HTTP transport or every possible failure.
- The existing `server/accounts.pg.test.ts` runs migrations and the account data layer against isolated in-process PGlite with a Neon tagged-query adapter. No live Neon service or Upstash REST credentials were available; deployment-specific transport, environment and failure behavior remain to be validated in a configured staging environment.
- Browser baseline captured in `baseline.md`. Accessibility conformance, new UI fidelity, child usability and learning outcomes are not yet verified.

## Learner smoke test — local browser

With a fresh in-memory server and disposable two-question deck, confirmed guest entry and public-name notice, title search, preview, wrong answer with supplied explanation, correct answer without explanation, points saved, results review, collapsed leaderboard and missed-question retry. The temporary deck was removed. This does not cover unavailable-service recovery, all adult/linked paths, screen readers, accessibility conformance or usability with children.

## Adult and linked learner smoke test

In disposable local mode, opened the parent workspace, created a nickname-only profile (public leaderboard unchecked), opened its one-use device invitation, started a linked session, answered a question and saw the confirmed point total on return. Automated tests cover revoked linked sessions, deleted profiles and account-scoped deck denial. The browser check did not yet exercise adult file upload, deck assignment, account deletion, or mid-session revocation; it is not a complete acceptance or accessibility audit.

## Additional checks

- Verified a disposable private deck upload, assigned it to the linked test profile, opened it through the linked-device flow, saved its answer and observed an all-correct results state without a missed-question retry. The local in-memory account and its data are disposable.
- Verified 320 CSS-pixel linked home, library and practice screens in the built-in browser; adjusted the mobile quiz header after observing truncation. This is not a full responsive or 200% zoom audit.
- With keyboard input, selected an answer by number, observed focus on feedback, and advanced with Enter. No actual screen reader was run, so assistive-technology compatibility is not yet established.
- The in-app browser file chooser took an unusually long time. File upload, account deletion, network-loss recovery and a full WCAG audit were not completed in the browser.
- Latest local automated validation after the leaderboard receipt change: 116 tests passed across 8 files; `npm run typecheck` passed. The new receipt test verifies that changing the public leaderboard cannot change an idempotent score response.

## Convergence implementation checks

- ScoreSaver tests verify in-flight callbacks do not update a later session, session-bound score requests reject a mismatched cookie, definitive rejections do not auto-retry, and an ambiguous post-commit response can be retried without double-credit. A denied batch reports the private deck ID and clears its queued work.
- A private-deck final request retains its deck and session identity; server tests reject finalization after unassignment.
- Keyboard testing in the in-app browser showed that a number key on the session's End button does not answer the question, while the same key on the focused question does. In both light and dark themes, session-bar time and points now use fixed foreground colors; their measured ratios on the fixed background are at least 8.65:1.
- Unavailable live Upstash and Neon staging transports and the full screen-reader, zoom, visual and participant checks remain open; these observations are not a WCAG conformance claim.

- Reproducible store checks: `python3 scripts/test-redis-score.py` passed against a temporary network-isolated Redis 7.4.2 container, including replay, payload conflict, type-error preflight and hidden-profile scoring. `npm test -- --run` passed 123 tests in 8 files, including PGlite-backed Neon-compatible account tests and the score regressions. PGlite is not a live Neon service, and Redis CLI is not the Upstash REST transport; T015 remains open for those production-equivalent service checks.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed. Vite reports a main JavaScript chunk larger than 500 kB after minification.
- The final empty score request now runs the same denial handling as an answer batch; a regression test verifies that a revoked deck is identified without reporting a final score as saved.

## Phase 9 implementation checks

- `src/scoreSaver.test.ts` verifies that clearing an expired round prevents later answers and an empty final flush from creating unbound requests. The interface now reports an expired save rather than attempting to score the completed round when the session has ended; full rendered expiry/restart coverage and confirmed-versus-unconfirmed presentation remain open under T055.
- `src/sessionAccess.test.ts` exercises delayed success, delayed denial, expiry during a request, missing session identity, and an active-session denial. Both preview and start checks use the guard. This is focused logic coverage; the linked and parent cache-removal browser scenarios remain open under T046/T057 and preview UI expiry under T048/T058.
- In the built-in browser at the default desktop viewport, a disposable guest opened a bundled deck, started practice, answered a question, saw feedback and a confirmed 10-point session total. Expiry, screen reader behavior, console inspection, screenshots and other viewport checks were not performed in this smoke test. The dedicated Browser plugin and project Playwright workflow were unavailable; the built-in computer-use browser was used for this interaction.
- `npm test` passed 129 tests across 9 files; `npm run build` (including type checking) and `git diff --check` passed. Vite still warns that the main JavaScript chunk exceeds 500 kB after minification. No configured Neon or Upstash connection variables were present in the process environment; production transport validation remains open.

## Session and access regression coverage

- `src/App.session.test.tsx` renders the application with mocked APIs and tests expiry from preview, expiry during practice, confirmed points, no post-expiry score request, restart with cleared save status, pending access checks during expiry, and removal of a denied private deck from both linked-device and parent-started libraries. `src/sessionAccess.test.ts` covers delayed successful and failed responses. These tests do not replace real-browser or real-service end-to-end checks.

## Rendered regression and automated accessibility checks

- Added React Testing Library and JSDOM coverage for unknown-save retry with an unchanged batch ID, device revocation during practice, missing explanations, answer review and missed-question retry, in addition to the session and access scenarios above. These use mocked API responses and do not prove browser-to-service integration.
- Axe-core reported no detectable WCAG 2/2.1/2.2 A/AA violations in the rendered library, preview, question, feedback and results test states. JSDOM lacks layout and canvas support, so contrast was disabled and icon-ligature analysis is limited; these checks are not an accessibility conformance audit and do not replace a screen reader, target-size, zoom or responsive checks.
- `npm test`: 138 tests across 10 files passed. `npm run build` (including typecheck) and `git diff --check` passed. The build still reports a main chunk above 500 kB. The real npm audit reports four high-severity dependency findings through the existing `@vercel/blob` / `@vercel/oidc` / `@vercel/cli-config` / `zod` chain; npm proposes a major-version downgrade of Blob, which was not applied without evaluating compatibility.
- Neon and Upstash connection variables were absent from the process and from the local Vite environment files checked; production transport checks remain open.

## Requested learner and adult verification

- Added rendered interaction regressions for focus on the library and preview headings, question feedback, next question and results heading. Fixed the three screen transitions that previously left focus on the document body. The checks run in JSDOM and are not a substitute for a screen-reader walkthrough or visual focus inspection.
- In a disposable local adult account, created a nickname-only profile, confirmed leaderboard visibility defaults to private, edited it to public and observed the resulting label, and inspected the files screen, storage limits and account-deletion explanation. The invitation was generated, but a device was not linked or revoked in this walkthrough; no file was uploaded and account deletion was not executed in this browser pass. Server tests exercise file access/deletion and account boundaries, but do not make this a complete browser end-to-end pass.
- Expanded the learner/adult usability protocol and the delayed-learning comparison design in `usability-results.md` and `learning-evaluation.md`. No participants, scores or study results are claimed.
- `npm test` passed 140 tests across 10 files; `npm run build` (including typecheck) and `git diff --check` passed. The production build continues to report a JavaScript chunk larger than 500 kB.
- The actual screen-reader audit, 200% zoom and full responsive/visual audit, plus the remaining guest/linked/adult browser acceptance cases, remain incomplete. T026, T028, T030, T037–T040 and T052–T054 remain open; T042/T043 remain open pending participant studies.
- Follow-up local browser pass: opened the disposable invitation, linked the device, started a learner session, answered a question and observed 10 confirmed points on learner home. Signed in as the disposable adult, removed the listed device, signed out, and verified the next learner start returned to guest entry with an ask-an-adult-for-a-new-link message. The client retained the prior learner home until that next server-backed action. This pass did not test mid-question revocation, network loss, assignment changes or browser expiry.


## Phase 2 foundation checks — isolated database engines

- `npm test -- src/deck.test.ts src/library.test.ts server/handlers.test.ts server/kid-links.test.ts server/library.test.ts`: 96 tests across 5 files passed using the existing in-memory handler stores.
- `scripts/test-foundation-postgres.sh`: 4 tests passed, including the same accounts, profiles, private-deck assignment, device, visibility and deletion scenario against memory and a disposable PostgreSQL 16 service. The script applies the real migrations, uses a unique container, publishes a loopback-only ephemeral port and removes the container on exit. This runs the account SQL through a `pg` tagged-query adapter; it is not the Neon serverless HTTP transport and does not run every T004–T006 handler scenario against PostgreSQL.
- `python3 scripts/test-redis-score.py`: passed against a network-isolated Redis 7.4.2 container for concurrent replay, conflict, type preflight failure, private scoring, replay and expired-session rejection. This runs the production Lua script through `redis-cli`, not the Upstash REST client or every T004–T006 handler scenario.
- `npm test`: 140 passed, one PostgreSQL service test skipped by default; the service test passed when run via the isolated script above. `npm run build` (including typecheck) and `git diff --check` passed; the build still reports a large main JavaScript chunk.
- No Neon or Upstash connection settings were found in the process or local Vite environment files. T015 remains open: the full T004–T006 regressions have not been run with both production-equivalent services or their hosted transports.


## Phase 2 dedicated transport runner

- Added `scripts/test-foundation-live.mjs` and `server/foundation.services.test.ts`. The runner requires `QUIZZLET_PHASE2_ISOLATED=YES` and dedicated `QUIZZLET_PHASE2_NEON_URL`, `QUIZZLET_PHASE2_UPSTASH_URL` and `QUIZZLET_PHASE2_UPSTASH_TOKEN` values. It reads the ignored `.env.phase2.local` file or inherited test-only variables, never falls back to application production settings, checks migration status without applying migrations, and uses unique disposable account, player, session and receipt identifiers. The live fixture attempts to clean up every identified test resource, and reports if cleanup fails.
- Run with `node scripts/test-foundation-live.mjs` after creating a dedicated Neon database with the project migrations and an isolated Upstash Redis database. The full test suite defaults to skipping the hosted test. Do not include credential values in logs or source control.
- The shared cross-store scenario passed in memory. It exercises legacy guest scoring, invalid payloads, concurrent replay, conflicts, an injected pre-commit failure, simulated lost-response retry, session expiry, linked and parent-started profiles, assignment and enabled state, cross-account denial, revocation and profile deletion. The live scenario has not run because the dedicated service settings were not present at the last check. These integration scenarios complement the existing detailed handler regressions; a passed smoke run does not imply every memory-only test ran on the hosted services.
- `npm test`: 141 passed, two service-only tests skipped. `npm run build` including typecheck passed; `git diff --check` passed. T015 remains open pending the isolated transport run and any remaining per-service coverage.
