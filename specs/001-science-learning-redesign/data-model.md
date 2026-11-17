# Phase 1: Data model

## Existing entities

### Deck / DeckEntry

`Deck`: title, optional description, enabled flag, shuffle flags, nonempty `cards`. `DeckEntry`: stable-in-context id, fileName, source (`bundled`, `imported`, `account`) and either parsed deck or validation errors/enabled status. A card has question, at least two distinct options, one matching answer, optional explanation and shuffle override. Account deck assignment is checked before presenting it to a learner. Invalid or disabled content is never playable.

**Proposed additive metadata:** optional author-provided `subject` text for verified content; missing means uncategorized. Parse/serialize consistently for bundled, imported and account YAML; no migration required for old decks. Search case-insensitively over title/description and filter only actual subject values. Do not infer subject or overwrite account-assigned titles. No durable question ID or question-level history is added.

### Learner and device

A parent-owned profile has id, nickname, grade band, color, emoji and `showOnLeaderboard`; false by default. A linked device has id, profile/account association and timestamps; a one-use invitation expires. Guest nickname and scoring identity are separate from managed profiles. Existing guest scores are public, while profile visibility depends on its setting. Linked-device access derives from an active device association, never a browser label.

### Session

Existing session contains id, name, player key, expiration, points and optional profile/visibility. **Proposed:** an optional linked-device binding for sessions created on linked devices, with enough server-side account/profile identity to verify the current association; parent-created and guest sessions remain distinct. Transitions: absent → active → expired, ended or revoked. A revocation prevents subsequent authorized actions once the server observes it. No promise of immediate offline revocation or retroactive erasure of already-delivered content.

### Round and answer

`Quiz` maintains in-memory ordered cards, selected answer, correctness and points; a retry creates a fresh round using missed cards. A user can exit but the current question position and answers do not survive reload. `ScoreSaver` holds correctness batches; best percentages in localStorage are browser-wide, not per profile. Avoid presenting them as individual mastery.

## Proposed score batch / receipt

- **Batch**: session-scoped opaque client-generated `batchId`, ordered boolean answers, `streakBefore`, optional final/leaderboard request, and for a linked private deck an authorized deck reference. One batch ID is reused for the exact same immutable payload; a changed payload requires a new ID.
- **Receipt**: session-scoped batch ID, payload fingerprint and original points/totals/response; stored atomically with scoring. Retain at least until session expiry plus a bounded retry window; no personally identifying question text is required.
- **Transitions**: queued → in flight → confirmed; failed transport → unknown → retry same ID → confirmed, or expired/revoked → not recoverable for new writes. Distinguish confirmed earlier batches from unknown or rejected batches. Conflicting reuse of an ID fails without changing totals.
- **Validation**: existing maximum batch size, boolean-only answers, streak validation and session authorization remain; rejected/unauthorized/conflicting batches never change score. Receipt and score updates are atomic for in-memory and Redis-backed stores, including concurrent retries and partial failures. Legacy clients are supported during rollout as specified in the contract.

## Proposed UI state (ephemeral)

Library search and optional subject selection, deck preview, quiz open/answered, per-batch save state, result review, optional leaderboard disclosure, adult management state and errors. These states do not imply durable pause, completed-question history or a scheduled review. On revocation or changed assignment, clear inaccessible content from active presentation at the next server check and show a safe path back.
