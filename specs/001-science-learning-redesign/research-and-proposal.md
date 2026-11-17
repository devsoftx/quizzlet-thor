# Research and UX/UI proposal: Science Field Journal

**Date:** 2026-11-16<br>
**Audience:** Learners 8–15; parents and teachers<br>
**Status:** Design proposal and research synthesis; not a tested design or implementation.

## Product opportunity

Quizzlet already offers shared and imported question decks, multiple-choice answers with optional explanations, retries, points and rankings, guest sessions, and adult-managed profiles, private decks, files, and linked devices. The current welcome explains points and public nickname visibility; the library is a list of decks; the learner progresses through a quiz to results. These observations come from the repository, not a live user study. The app also contains history, geography and other material; a science-led redesign should preserve access to those decks.

The opportunity is to make choosing, practicing, recovering from mistakes and returning feel like one understandable learning journey. The evidence below informs the direction; visual choices and numerical usability targets are hypotheses to test, not findings established by the research.

## Research: what transfers to this product

| Finding | Evidence and limits | Design implication |
| --- | --- | --- |
| Recall strengthens durable learning | The [US Institute of Education Sciences practice guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1) recommends active retrieval across learning phases for content-rich subjects including science. It is instructional guidance, not proof that this particular app improves science outcomes. | Keep low-stakes questions central; offer a clear retry and later review if the required history is available. Do not equate points with mastery. |
| Feedback should help learners improve | [EEF feedback guidance](https://educationendowmentfoundation.org.uk/education-evidence/teaching-learning-toolkit/Feedback) reviews feedback in different forms; effectiveness depends on how it is used. | Show correctness, the answer and an author-written explanation; when absent, be honest rather than inventing one. Invite another try without shame. |
| Plan, monitor, reflect | [EEF metacognition guidance](https://educationendowmentfoundation.org.uk/education-evidence/guidance-reports/metacognition) emphasizes strategies tied to subject content. Evidence often concerns supported teaching, not an independent app screen. | Say what a deck covers, show simple progress, and end with a concrete review choice; test whether prompts help rather than distract. |
| Agency and focused exploration | [PhET’s research program](https://phet.colorado.edu/en/research) uses student interviews to refine science simulations; [PhET’s interview study](https://phet.colorado.edu/publications/PhET_Interviews_I.pdf) emphasizes learner-driven inquiry. Simulation evidence does not establish efficacy for a flashcard interface. | Offer meaningful topic and pace choices. Explore a small prediction-and-observation interaction later, only with accessible content and learning evaluation. |
| Children need access and control | [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) provides testable accessibility criteria; [UNICEF’s digital play framework](https://www.unicef.org/childrightsandbusiness/reports/ritec-overview-infographic-posters) includes autonomy, competence, inclusion and safety. | Accessible controls and feedback, optional motion, no mandatory rankings, and privacy explained in context. Conduct research across age groups and access needs. |

### Reference cases, not templates to copy

- **PhET Interactive Simulations:** a science-specific example of interactive exploration and iterative student interviews. Useful lesson: test whether children understand and explore concepts; a visually rich simulation is not automatically effective. It is a possible later direction, not a requirement for the first redesign. [PhET research](https://phet.colorado.edu/en/research).
- **ASSISTments:** seventh-grade mathematics homework uses immediate feedback, hints and reassessment. An [IES replication study](https://ies.ed.gov/use-work/awards/efficacy-assistments-online-homework-support-middle-school-mathematics-learning-replication-study?ID=2058) describes a school-level randomized design and notes pandemic-related changes in outcome measurement. This is an adjacent subject and context; borrow the feedback pattern, not an assumed effect size.
- **PBS KIDS Play & Learn Science:** a [supported-context evaluation](https://www.sri.com/publication/education-learning-pubs/digital-learning-pubs/pbs-kids-play-learn-science-ready-to-learn-funded-evaluation/) examined science understanding and parent-child engagement. It focuses on younger children and additional supports, so it motivates adult scaffolding rather than a claim of independent effectiveness for ages 8–15.

## Proposed experience: Science Field Journal

**Creative idea:** The learner is an explorer collecting observations and building understanding. The interface borrows from field notes, specimen labels and scientific diagrams, with precise typography and energetic color. It should feel curious and capable for a 15-year-old while remaining legible and approachable for an 8-year-old. Avoid babyish mascots, laboratory clichés, fake scientific data, noisy confetti and pressure to maintain a streak.

### Visual system

- **Color:** warm paper or soft mineral backgrounds, deep ink text, vivid teal for primary actions, amber for curiosity and coral for feedback accents. Assign colors to subjects only alongside visible labels; verify every final combination for contrast.
- **Type and layout:** readable humanist sans-serif, large question text, restrained display headings, generous line spacing, clear left alignment, strong hierarchy and wide enough answer targets. Use a clean grid and scientific diagram accents, not a card around every element.
- **Illustration:** editorial science illustrations and simple line diagrams that support content. Avoid decorative images that compete with questions; never imply a diagram is scientifically accurate without review.
- **Motion and sound:** brief optional feedback transitions, no audio required, and an equivalent reduced-motion experience.
- **Voice:** encouraging, direct, age-respectful: “Good thinking. Here’s why…” and “Try these again,” never “You failed.”

### Information architecture

**Learner:** Start / learner identity → Explore topics and decks → Deck preview → Practice → Feedback → Results and review → Explore again. A linked learner has a personalized entry; a guest has a clearly labeled limited-persistence entry.<br>
**Adult:** Adult sign-in → Learners / Decks / Files / Settings → profile, assignment and device management. Adult controls are clearly separated from the learner’s primary task without pretending a visual separation is a security boundary.

### Screen-by-screen proposal

1. **Welcome:** prominent “Start exploring” and secondary “Parent or teacher”; explain nickname visibility *before* submission and offer guest or linked learner paths as applicable. Avoid a rules-heavy point chart at the top. Preserve actual session limits and privacy behavior.
2. **Explore:** a quiet header with learner identity and session status, one primary “Choose a topic” region, a search field, subject filters, and distinct deck rows showing title, available subject and question count. Offer a “Continue” suggestion only where a real resumable state exists. Empty, disabled and invalid content has clear recovery guidance.
3. **Deck preview:** show title, what the available content covers, number of questions and “Start practice.” Give a choice of pace or session length only if supported. Do not generate objectives from unverified deck content.
4. **Practice:** one question per screen, explicit current/total progress, large answer buttons and an obvious exit. Once selected, announce the result and show the correct answer and supplied explanation in a stable panel, followed by “Next question.” No automatic advance; retain keyboard controls and make focus changes predictable.
5. **Results:** lead with effort and accuracy, followed by reviewable missed questions and a primary “Practice missed questions” when applicable. Offer “Explore more” and optionally “View leaderboard”; no child is required to compare themselves to others. Show save state and recovery options accurately.
6. **Returning learner:** show a welcoming identity, a direct start action, available progress and an honest review suggestion only if supported by stored data. Do not imply current points measure conceptual mastery.
7. **Adult workspace:** a clear learner list and separate sections for profiles/devices, decks, files and settings. Explain private versus public visibility at the control; show invite expiry, device revocation, assignment and account deletion consequences.

### Age and accessibility adaptations

Use one coherent visual system with flexible reading support rather than forcing a child into an age category. For 8–10, test shorter wording, concrete examples and optional adult support; for 11–13, test more independent navigation and topic choice; for 14–15, test denser optional context and restrained styling. Do not assume every learner of an age has the same reading level. Support keyboard and screen readers, 200% text zoom, clear touch targets, visible focus, reduced motion and WCAG 2.2 AA contrast. Use both text and symbols to communicate states.

### Boundaries and dependencies

Existing question explanations are optional; editorial work is needed to improve coverage. Search, meaningful topic metadata, later review, progress beyond current scores, and richer illustrations require discovery and may need additional product work. Delayed review needs reliable question-level history, privacy decisions and content eligibility; it is not currently claimed as available. Simulations, social messaging, adaptive AI tutoring and new curricular content are future ideas outside the initial redesign. Retain other subject decks and existing parent/child access, device linking, points and file workflows.

## Validation and delivery

1. **Baseline:** Observe current guest, linked learner and adult journeys; measure task completion, time, confusion, errors and save-state comprehension. Audit existing question explanations and assess current accessibility.
2. **Co-design and concept test:** Recruit learners across 8–10, 11–13 and 14–15, including different reading and access needs, with appropriate guardian permission and child assent. Test two visual treatments and language without assuming preferences by age. Include parents and teachers for adult flows.
3. **Prototype test:** At least 5 participants per age cohort per iteration as a directional usability sample, plus accessibility specialists and adult participants; observe rather than lead. Test first entry, finding a science deck, an incorrect answer, retry, session expiry, linked-device entry, privacy choices and adult revocation. Track the acceptance targets in the specification by cohort and device; small samples are not population estimates.
4. **Accessibility and product validation:** Audit WCAG 2.2 AA, keyboard, screen-reader, zoom and reduced-motion behavior; verify actual leaderboard and persistence states. Test narrow and wide screens and long science terms.
5. **Learning evaluation:** Separately design a comparison with baseline and delayed assessment of equivalent science content, meaningful sample size and appropriate permission. Report retention and uncertainty, not just clicks, scores or time in app. Iterate before claiming learning gains.

**Recommended sequence:** First design and test the entire journey, then build the core entry → explore → practice → feedback → results loop, then adult and linked-device refinements. Consider stored review and inquiry activities only after confirming content, privacy and measurement requirements.
