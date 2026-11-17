# Phase 0: Implementation research

See [research-and-proposal.md](research-and-proposal.md) for the educational evidence, applicability and design direction. Findings here resolve implementation choices based on the current repository and primary technical references.

## UI composition and rendering

**Decision**: Retain React/Vite and split screens and shared controls around existing `App.tsx` screen/session transitions. Derive filtered decks from current library data at render time, preserve quiz instance identity and event guards, and use effects for external synchronization.<br>
**Rationale**: The existing SPA already supports the whole journey; [React guidance](https://react.dev/learn/you-might-not-need-an-effect) recommends calculating derivable values during render; [state identity guidance](https://react.dev/learn/preserving-and-resetting-state) explains why remounts can reset work.<br>
**Alternatives considered**: New routing/state framework or wholesale rewrite; both introduce migration risk without a demonstrated need.

## Accessible feedback and motion

**Decision**: Use semantic controls, an understandable focus sequence, explicit visible result text and a screen-reader-testable status strategy; respect reduced-motion preference and audit the full WCAG 2.2 AA criteria. Confirm behavior with real assistive technology, especially when moving focus after answering.<br>
**Rationale**: [W3C focus order guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-order) and [status-message guidance](https://www.w3.org/WAI/WCAG21/Understanding/status-messages) distinguish focus and status announcements; [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion) documents the user motion preference.<br>
**Alternatives considered**: Keep the purely animated flip or rely on color/automatic announcements; both leave interaction or comprehension gaps.

## Search and subject metadata

**Decision**: Search valid visible titles/descriptions locally; introduce an optional validated, author-supplied subject for curated decks only, with an explicit uncategorized fallback and compatibility for existing YAML/imported and private decks. Present a subject filter only for actual supplied values; preserve access to non-science and uncategorized decks.<br>
**Rationale**: `Deck` has no subject field; inferring it from filenames is unreliable. Card count is available for valid decks.<br>
**Alternatives considered**: Classify by filename or hardcode all as science; both can mislabel learning content. Defer adding topic tags or inference.

## Save correctness and retry

**Decision**: Give each submitted batch a stable unique ID; atomically deduplicate within a session and apply totals together, returning the original receipt for a retry of the identical payload. Treat a lost response as unknown until same-ID retry resolves it; distinguish known failure from expiry/revocation and previously confirmed saves. Keep the current in-memory queue, with explicit loss limitations on tab close.<br>
**Rationale**: `ScoreSaver` retries correctness batches after errors, but `/api/score` currently has no idempotency and can apply a committed batch twice. Browser keepalive is best-effort, not proof of persistence. The [score contract](contracts/score-and-access.md) defines rollout, atomicity and test cases.<br>
**Alternatives considered**: Assume a network failure means no commit, or add a UI-only “saved” indicator; both misstate outcomes. Durable offline answer history is outside this redesign.

## Session and deck access

**Decision**: Bind sessions started on linked devices to the validated device identity; validate it on session-sensitive server requests. Revalidate private deck assignment at preview/start and at each answer submission boundary using the account-scoped authorized deck; stop the active UI on denial. Define the realistic limit: content already sent cannot be retracted and offline revocation is detected on the next successful check.<br>
**Rationale**: Existing session lookup checks the cookie and expiry but does not check device association; private decks arrive as full YAML and assignments may change.<br>
**Alternatives considered**: Hide a screen or assume revocation is immediate on the browser; neither enforces access. Streaming or encrypted question delivery is a separate security architecture.

## Privacy and rankings

**Decision**: Keep guest public listing and existing profile opt-in semantics, disclose them before entry, and make ranking display optional. Decouple score-save success from leaderboard retrieval.<br>
**Rationale**: The board being hidden is not equivalent to data being private; current final-save logic expects a leaderboard even when not needed for score success.<br>
**Alternatives considered**: Silently make guests private or hide disclosure; first changes product semantics, second misleads.

## Testing and validation

**Decision**: Use existing Vitest/typecheck/build for meaningful score, parsing, authorization and regression tests; inspect actual browser interactions across devices, with keyboard, screen-reader and reduced motion. Make visual concept generation and concept-to-render comparison an implementation prerequisite. Conduct child research and learning evaluations separately.<br>
**Rationale**: Unit tests alone cannot establish visual quality, accessible interactions or learning outcomes.<br>
**Alternatives considered**: Rely only on snapshots or infer student outcomes from points; both lack required evidence.
