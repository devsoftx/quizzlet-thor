# Implementation validation quickstart

This guide describes checks **after implementation**. The redesigned flows and proposed contracts are not yet implemented.

## Setup

From the repository root, use the existing development configuration and dependencies:

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

Open the local URL printed by Vite. The documented local development sign-in uses in-memory account data and does not require production credentials; data resets when the server restarts. Use test-only accounts and decks, not real children’s data. For Redis/Neon-specific atomicity and authorization checks, use isolated configured test services; a successful local-memory run is not proof of production-store atomicity.

## Learner paths

1. As a guest, verify public nickname disclosure before entry; search for a science deck and an unrelated non-science deck. Inspect unknown-subject and no-results states. Start a valid deck, answer correct and incorrect questions, including one without an explanation, and verify next, review and missed retry. Check that rankings are optional and no results fetch failure changes the saved-score result.
2. With a parent-managed profile and linked device, practice an assigned private deck. Verify profile privacy, linked entry, expiry and return paths. Revoke the device during study, then perform the next server-backed action: it is rejected, inaccessible content leaves the active UI, and the learner receives a clear next step. Repeat with an unassigned or disabled private deck; already downloaded content cannot be retroactively removed from the device.
3. Simulate a failed network response after the server has committed a score and retry the same batch ID: totals increase once and the same receipt returns. Try a conflicting payload and concurrent duplicates. Verify pending/unknown, confirmed, expired and revoked statuses; close-tab save is never represented as guaranteed. Run both memory and production-equivalent store tests.
4. As an adult, create/edit a profile, change ranking visibility, create/revoke an invite and device, manage an assigned deck and file, access settings and test account deletion with disposable data. Verify authorization and actionable errors.

## Accessibility, responsive and visual verification

- Test 320 CSS-pixel, tablet and desktop layouts; 200% zoom and long question/answer text without clipped controls. Use keyboard only for entry, search, answer, feedback, results and adult forms. Verify focus order, focus visibility, accessible names, feedback announcement and no duplicate answer submission.
- Test with a screen reader, reduced-motion preference, and color-independent feedback; run a full WCAG 2.2 AA audit including contrast and target sizes. Automated checks supplement, not replace, manual testing.
- Generate and review complete concept references before implementation, then compare browser screenshots of each implemented state and mobile layout with those references. Record at least layout, typography, color, content, assets and spacing differences and correct them. Use the built-in browser first; document any fallback. Inspect concept and browser screenshots side by side.
- Conduct the specified cohort usability and separate delayed-learning evaluations only with appropriate permission, consent/assent and recruitment. Record actual denominators, results and limitations; none are implied by a successful build.

See [learner-ui.md](contracts/learner-ui.md), [score-and-access.md](contracts/score-and-access.md) and [data-model.md](data-model.md) for expected behavior and test boundaries.
