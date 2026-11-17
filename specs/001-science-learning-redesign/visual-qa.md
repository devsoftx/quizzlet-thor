# Visual review in progress

Reference images are design studies under `concepts/`; they include invented example content and do not override real application behavior. This is not a completed visual-fidelity sign-off.

| Area | Reference | Current observation | Follow-up |
| --- | --- | --- | --- |
| Entry | Warm field-journal entry, prominent guest action and privacy disclosure | Dark-system rendering uses a naturalist fern/moth illustration, large serif heading, guest form and public nickname notice | Review light theme and compare at the reference dimensions; the composition is intentionally different from the generated entry image. |
| Library | Searchable deck rows, teal actions and science illustrations | Search, actual deck titles and counts render; untagged decks are labeled uncategorized | Compare desktop and mobile with concept; artwork and spacing remain different. |
| Practice | One question, clear feedback, next action | Keyboard shortcut, correct/incorrect text and provided explanation were observed; 320px long question reflowed | Recheck mobile title after CSS repair; run actual screen-reader and 200% zoom checks. |
| Results | Review, missed-question retry, optional ranking | Disposable two-question round displayed review and retry; leaderboard was collapsed | Compare layout and typography with concept and test all-correct state. |
| Parent | Workspace with profile and device controls | Disposable local profile and invitation worked, and privacy default was visible | Inspect and compare remaining adult screens, file/deck flows and account deletion with disposable data. |

Screens were observed in the built-in browser. A saved browser screenshot and same-dimension concept-to-render review are still needed before marking T038 complete.

A 320 CSS-pixel browser inspection found quiz title truncation; a narrow-screen grid and wrapping rule were added. The keyboard number shortcut and Enter advance were exercised, with focus observed on the feedback and next question. A full audit and a same-dimension screenshot comparison remain outstanding.

## Adult profile comparison — preliminary

Viewed `concepts/adult.png` and the local adult profiles screen at their available, different dimensions. The concept uses a pale textured journal, a persistent left navigation, illustrative portraits and an expanded profile/device detail panel. The current dark-theme screen uses a flat background, a back button, one compact profile row, emoji avatar and collapsed device detail. The visible heading is a large serif in both. This is a qualitative mismatch record, not a same-size comparison or sign-off; light theme, mobile and the remaining screens still need inspection. Existing product controls and real profile data take precedence over concept sample content.
