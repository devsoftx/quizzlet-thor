# UI contracts

## Navigation and discovery

- Guest entry requests a nickname only after saying it appears on the public leaderboard when points are earned. Adult-managed profiles retain their current visibility selection. Linked-device entry shows profile, session start and unlink where applicable. Adult entry routes to authenticated management.
- Library displays only learner-authorized decks; search matches title/description, and the optional subject filter uses author-supplied values plus uncategorized. Display valid deck title and question count; never make invalid/disabled content playable. Parent-facing diagnostics identify invalid data without disclosing inaccessible content.
- Preview shows known title, description and count; start opens a fresh ordered quiz. A true resume control may appear only when the app actually persists a resumable state.

## Practice and feedback

- One question, labeled progress, selectable answer buttons and exit. Exactly one submission per question despite double clicks or keyboard events. After selection, show correct/incorrect text, the correct answer and only the supplied explanation. Explicit next advances; screen-reader users can perceive feedback before moving on. Keyboard shortcuts do not capture input while typing or conflict with native focused buttons.
- Exiting tells the learner what is confirmed, pending or unknown; do not claim current question state is saved. The user can navigate without punitive copy. Network timeout may have committed; do not assert failure until known.
- Results show accuracy and review, conditionally retry missed, explore again and optional leaderboard. Ranking is never required to learn or to report successful score saves. Announce async status without disruptive repeated announcements.

## Adult and access states

- Adults can manage profiles, private deck assignments, files, invitation/device lifecycle, settings and account deletion with clear effects and errors. Parent authentication and authorization remain server-enforced.
- A revoked linked device or changed private assignment is detected at the next server check. Stop new access, remove current inaccessible deck from the active view and offer a safe return. Already received data cannot be recalled. Network outages present an honest unknown/offline state.

## Cross-cutting

All core journeys support 320 CSS-pixel width, 200% zoom, keyboard navigation and visible focus; meet WCAG 2.2 AA after audit. Do not rely on color, sound or animation alone; honor reduced motion. Text is age-respectful, avoids shaming, and is clear about score and privacy. Validate guest, parent-started and linked-profile variants separately.
