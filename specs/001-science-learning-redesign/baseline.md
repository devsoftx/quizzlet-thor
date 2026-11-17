# Current experience baseline

Observed on 2026-11-16 in local development, using a disposable guest nickname. This is a functional inspection, not child usability research or a full accessibility audit.

- Welcome asks for a nickname, explains its public leaderboard visibility and 60-minute duration, displays rankings and a points tutorial, and offers adult sign-in.
- After starting, a session bar displays nickname, points and time; the library shows a long list of deck titles, descriptions and card counts with Study buttons. The leaderboard and disabled decks are collapsed. There is no search or subject metadata.
- Selecting Study begins the full deck immediately. The quiz shows progress, answers and keyboard hints; after an incorrect choice it shows the correct answer and advances focus to Next. The inspected question lacked an explanation. Existing source supports optional explanations and results review/retry.
- Source inspection shows adult sign-in, profile management, private decks, files, settings and device links. The linked-device journey starts a profile session. These adult and linked flows were not fully exercised in this baseline.
- Guest points are publicly listed; managed profiles have an adult-controlled visibility setting. Client score batches are held in memory and retries are not idempotent, so a lost response can leave an ambiguous save. Existing linked sessions do not revalidate device revocation. See `plan.md` and `contracts/score-and-access.md`.
- The app supplies keyboard controls and some live feedback, but this inspection does not establish WCAG conformance or screen-reader usability. Points, session state and browser-wide best scores do not establish individual learning mastery.
