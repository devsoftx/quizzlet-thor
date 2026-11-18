// Everything the app says, in English. The Spanish catalog (es.ts) must have
// exactly the same shape: TypeScript checks every key and every parameter.
//
// Plain strings for fixed text; functions for text with values in it, so each
// language can order words, plurals and possessives its own way. Strings with
// {braces} are filled with markup by rich() (see rich.tsx).
import { deckMessagesEn } from "../deck-messages";

const num = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

export const en = {
  /** This language's own name, for the language switch. */
  languageName: "English",
  /** Used to format numbers and dates. */
  locale: "en-US",
  language: {
    switchLabel: "Language",
  },

  common: {
    loading: "Loading…",
    back: "← Back",
    cancel: "Cancel",
    save: "Save",
    edit: "Edit",
    remove: "Remove",
    delete: "Delete",
    ok: "OK",
    somethingWentWrong: "Something went wrong.",
    pts: (n: number) => `${num(n)} pts`,
    parentSignIn: "Parent or teacher sign in",
    uncategorized: "Uncategorized",
    imported: "Imported",
    private: "Private",
    downloadTemplate: "Download template",
    templateFileName: "quizzlet-deck-template.yaml",
    questionCount: (n: number) => `${num(n)} ${plural(n, "question", "questions")}`,
  },

  // Messages the app shows when a session or account changes (App.tsx).
  app: {
    deviceUnlinked: "This device is no longer linked. Ask an adult for a new link.",
    deviceUnlinkedPointsLost: "This device is no longer linked. Ask an adult for a new link. Recent points may not have been saved.",
    profileGone: "This profile is no longer available. Ask an adult to start a new session.",
    profileGonePointsLost: "This profile is no longer available. Ask an adult to start a new session. Recent points may not have been saved.",
    deckGone:
      "This deck is no longer available. Your most recent answers may not have been saved. Access changes can only be checked when connected; downloaded content may remain on this device.",
    deckCantOpen:
      "This deck couldn't be opened. Check your connection or ask an adult. Access changes can only be checked when connected; downloaded content may remain on this device.",
    confirmUnlinkUnsaved: "Some recent points have not been confirmed. Remove this device anyway?",
    unlinkCancelled: "Device removal cancelled; your points are still waiting.",
    deviceRemoved: (unconfirmed: boolean) =>
      `This device was removed. Ask your parent for a new link to study as yourself again.${unconfirmed ? " Some recent points could not be confirmed." : ""}`,
    confirmSignOutUnsaved: "Some recent points have not been confirmed. Sign out anyway?",
    signOutUnconfirmed: "Some recent points could not be confirmed before sign-out.",
    accountDeleted: "Your account and all its kid profiles were deleted.",
    sessionTimeUp: (name: string, points: number, unconfirmed: boolean, guest: boolean) =>
      `Your session has ended, ${name}. ${num(points)} ${plural(points, "point was", "points were")} confirmed.${unconfirmed ? " Some recent points could not be confirmed." : ""}${guest ? " Enter your name to start a new session." : ""}`,
    confirmEndUnsaved: "Some answers may not be saved yet. End the session anyway?",
    endUnconfirmed: "Some recent points could not be confirmed before the session ended.",
    sessionExpired: (guest: boolean) =>
      `Your session has ended. Recent points may not have been confirmed.${guest ? " Enter your name to start a new one." : ""}`,
    scoreUnknown: "The score status is unknown.",
    importSome: (added: number, failures: string[]) => `${added ? `Added ${num(added)}. ` : ""}Couldn't add ${failures.join("; ")}`,
    importAdded: (n: number) => `Added ${num(n)} ${plural(n, "deck", "decks")} to your family's private decks.`,
    previousUnconfirmed: "Some points from the previous session could not be confirmed.",
    accountLoadFailed: (message: string) => `Couldn't load your account: ${message}`,
    signOut: "Sign out",
    signInDev: "Sign in (local dev)",
    signInGoogle: "Sign in with Google",
    finish: "Finish",
    pointsRejected: "Some recent points were rejected. End this session and start a new one.",
    pointsUnconfirmed: "Some recent points have not been confirmed.",
    retrySaving: "Retry saving",
    saveStatus: {
      confirmed: "Points saved",
      saving: "Saving points…",
      unknown: "We couldn't confirm whether your latest points were saved",
      failed: "Your latest points could not be saved",
      other: "Your latest points may not have been saved",
    },
  },

  welcome: {
    startFailed: "Couldn't start your session.",
    kicker: "A little curiosity goes a long way",
    titleLine1: "Big questions.",
    titleLine2: "Bright ideas.",
    intro: "Explore a world of questions, discover something new, and learn at your own pace.",
    step: "01 / START HERE",
    entryTitle: "Ready to explore?",
    entryText: "Choose a nickname and pick a deck to begin.",
    nickname: "Your nickname",
    nicknamePlaceholder: "For example, Nova7",
    privacyLead: "Choose carefully:",
    privacy: "Your nickname appears on the public leaderboard when you earn points. Please don't use your real name.",
    starting: "Starting…",
    start: "Start exploring",
    sessionLength: "Your study session lasts 60 minutes.",
  },

  sessionBar: {
    label: "Your session",
    pointsTitle: "Points earned this session",
    lessThanAMinute: "less than a minute left",
    minutesLeft: (m: number) => `${num(m)} min left`,
    switchProfile: "Switch profile",
    end: "End session",
  },

  deckList: {
    title: "Explore decks",
    subtitle: "Find something interesting. See what you know.",
    importYaml: "Import YAML…",
    search: "Search decks",
    searchPlaceholder: "Search by title or description",
    subject: "Subject",
    allSubjects: "All subjects",
    deckLanguage: "Deck language",
    allLanguages: "All languages",
    noMatch: "No decks match that search.",
    noMatchHint: "Try another word or subject.",
    noEnabled: "No enabled decks.",
    noEnabledHint: "Ask an adult to make a deck available.",
    noDecks: "No decks yet.",
    noDecksHint: "Ask an adult to add a deck, or import one here.",
    study: "Study",
    studyDeck: (title: string) => `Study ${title}`,
    problems: "This deck has problems:",
    moreProblems: (n: number) => `…and ${num(n)} more`,
    hiddenCount: (n: number) => `${num(n)} ${plural(n, "deck", "decks")} hidden (not enabled)`,
    hiddenHint: "Set {enabled} at the top of the YAML file to show a deck.",
    formatSummary: "How to write a deck (YAML format)",
    formatHelp:
      "Put files in the project's {decks} folder (they show up automatically), or import one here. Only decks with {enabled} are shown, and {answer} must match one of the {options} exactly.",
    templateLink: "Download the deck template",
    templateLinkHint: "— a commented example to copy and fill in.",
    example: `title: Norse Mythology
description: Gods, realms and legends
language: en           # optional: the language the cards are written in
enabled: true          # required: only enabled decks are shown
shuffle: true          # shuffle card order (default: true)
shuffleOptions: true   # shuffle answer options (default: true)

cards:
  - question: Who is Thor's father?
    options:
      - Odin
      - Loki
      - Tyr
      - Baldur
    answer: Odin
    explanation: Odin, the All-Father, rules Asgard.  # optional`,
    drop: "Drop YAML file to import",
  },

  preview: {
    back: "← Back to decks",
    kicker: "Your next discovery",
    start: "Start practice",
  },

  quiz: {
    back: "← Decks",
    retrying: "Retrying missed",
    progress: "Progress",
    roundPoints: (n: number) => `${num(n)} ${plural(n, "point", "points")} this round`,
    answered: "Questions answered",
    think: "Take a moment to think",
    hint: "Choose an answer or press a number key.",
    right: "✓ That's right",
    wrong: "Not quite — let's look at it",
    answerIs: "The answer is {answer}.",
    youChose: (option: string) => `You chose ${option}.`,
    plusPoints: (n: number) => `+${num(n)} ${plural(n, "point", "points")}`,
    seeResults: "See results",
    next: "Next question",
  },

  results: {
    perfect: "Every question answered. Wonderful work!",
    great: "Nice exploring. See what you discovered below.",
    good: "Every question is a chance to learn something new.",
    keepGoing: "Curiosity starts with trying. Take another look below.",
    saving: (n: number) => `Saving your +${num(n)} points…`,
    expired: (n: number) =>
      `Your session ended. ${num(n)} ${plural(n, "point was", "points were")} confirmed in this session. Recent points may not have been confirmed, and answers after the session ended were not saved.`,
    newSession: "Start a new session",
    rejected: "Your latest points were rejected.",
    unknown: "We couldn't confirm whether your latest points were saved.",
    tryAgain: "Try again",
    pointsThisRound: "points this round",
    thisSession: "This session",
    allTime: "All-time total",
    missedEyebrow: (title: string) => `${title} · missed questions`,
    percent: (p: number) => `${p}%`,
    percentCorrect: (p: number) => `${p}% correct`,
    correctOf: (correct: number, total: number) => `${num(correct)} of ${num(total)} correct`,
    practiceMissed: (n: number) => `Practice missed questions (${num(n)})`,
    restart: "Restart deck",
    exploreMore: "Explore more decks",
    review: "Review",
    correct: "Correct",
    wrong: "Wrong",
    answer: "Answer:",
    youChose: "You chose:",
  },

  leaderboard: {
    title: "Leaderboard",
    loadFailed: "Couldn't load the leaderboard right now.",
    empty: "No points yet — be the first on the board!",
    rank: (n: number) => `Rank ${num(n)}`,
    kidProfile: "Kid profile",
    you: "You",
  },

  kid: {
    linkIncomplete: "This link isn't complete. Ask your parent to send it again.",
    linkRetry: "This device couldn't be linked. Please try the link again.",
    linkFailed: "This device couldn't be linked.",
    checking: "Checking your link…",
    studyAsQuestion: (name: string) => `Study as ${name}?`,
    linkExplain: (name: string) =>
      `This device will be linked to ${name}'s profile, so you can study here and earn points. No email or password needed. Your parent can remove this device anytime.`,
    linking: "Linking…",
    useDevice: (name: string) => `Use this device as ${name}`,
    notNow: "Not now",
    welcomeBack: (name: string) => `Welcome back, ${name}.`,
    pointsSoFar: (n: number) => `${num(n)} ${plural(n, "point", "points")} so far`,
    ready: "Ready for another discovery? Your study session lasts 60 minutes.",
    explore: "Explore decks →",
    confirmUnlink: (name: string) => `Remove this device from ${name}'s profile? You'll need a new link from your parent.`,
    notMe: (name: string) => `Not ${name}? Remove this device`,
  },

  links: {
    copyFailed: "Couldn't copy. Select the link and copy it instead.",
    sendTo: (name: string) => `Send this link to ${name}.`,
    sendHow: (until: string) => `Open it on their own tablet or computer to link that device. It works once, until ${until}.`,
    linkFor: (name: string) => `Invitation link for ${name}`,
    copied: "Copied!",
    copy: "Copy link",
    share: "Share…",
    shareText: (name: string) => `Study as ${name} on Quizzlet`,
    warning: (name: string) => `Anyone with this link can link a device as ${name}, so send it only to them.`,
    waiting: (until: string) => `A link is waiting to be opened (until ${until}).`,
    newLink: "Make a new link",
    linkDevice: "+ Link a device",
    cancelLink: "Cancel link",
    devicesOf: (name: string) => `${name}'s devices`,
    removeHint: "Removing a device stops future access when it next connects. Content already downloaded cannot be recalled.",
    noDevices: "No devices linked yet.",
    deviceDates: (linked: string, lastUsed: string, until: string) => `· linked ${linked} · last used ${lastUsed} · works until ${until}`,
    removeDeviceLabel: (device: string, name: string) => `Remove ${device} from ${name}'s devices`,
    confirmRemove: (device: string, name: string) => `Remove ${device}? It will stop studying as ${name}.`,
    /** Parts of a device's name ("Android tablet · Chrome"), as the server words them. */
    deviceWords: {} as Record<string, string>,
  },

  parentHome: {
    startFailed: "Couldn't start the session.",
    workspace: (name: string) => `Parent & teacher workspace · ${name}`,
    myDecks: "My decks",
    myFiles: "My files",
    settings: "Settings",
    title: "Who's exploring today?",
    intro: "Choose a learner to begin, or manage your family's study space.",
    noProfiles: "No kid profiles yet.",
    noProfilesHint: "Create a nickname-only profile for each child who studies with Quizzlet.",
    addProfile: "Add a profile",
    /** Read before the nickname by screen readers, on each profile tile. */
    studyAs: "Study as ",
    starting: "Starting…",
    manage: "Manage profiles",
  },

  settings: {
    saved: "Saved.",
    saveFailed: "Couldn't save.",
    deleteFailed: "Couldn't delete the account.",
    title: "Account settings",
    yourName: "Your name",
    yourNameHint: "Only you see this. Kids appear by their profile nickname.",
    theme: "Theme",
    themes: { system: "Match this device", light: "Light", dark: "Dark" },
    cardOrder: "Card order",
    cardOrders: { deck: "Each deck decides", on: "Always shuffle", off: "Never shuffle" },
    saveSettings: "Save settings",
    deleteTitle: "Delete my account",
    deleteText:
      "Permanently deletes your account, all kid profiles and their leaderboard points, your private decks and your files. This can't be undone.",
    /** The word to type to confirm. */
    deleteWord: "DELETE",
    typeToConfirm: "Type {word} to confirm",
    deleteButton: "Delete my account",
  },

  profiles: {
    title: "Learner profiles",
    intro:
      "Each profile is just a nickname and a picture — no real names, emails or birthdays. Kids pick their profile on this device, or open their invitation link on their own tablet or computer, to study and earn points.",
    linksFailed: (message: string) => `Couldn't load linked devices: ${message}`,
    nickname: "Nickname",
    nicknamePlaceholder: "e.g. StarCat (not their real name)",
    grade: "Grade",
    gradeNotSet: "Not set",
    grades: { "k-2": "Grades K–2", "3-5": "Grades 3–5", "6-8": "Grades 6–8", "9-12": "Grades 9–12" },
    color: "Color",
    picture: "Picture",
    showOnBoard: "Show this nickname on the public leaderboard",
    showOnBoardHint: "(off keeps this profile's score off the public board)",
    deleteProfile: "Delete profile",
    confirmDelete: (name: string) => `Delete ${name}'s profile? Their points will be removed.`,
    noGrade: "Grade not set",
    onBoard: "On the leaderboard",
    devices: "Devices",
    editLabel: (name: string) => `Edit ${name}`,
    newProfile: "New profile",
    create: "Create profile",
    add: "+ Add a profile",
    deviceCount: (n: number) => (n === 0 ? "No devices linked" : `${num(n)} ${plural(n, "device", "devices")} linked`),
  },

  myDecks: {
    title: "Private decks",
    intro:
      "Your private collection stays in your account. Choose which learners can see each deck, or switch it off to hide it from everyone.",
    off: "Off: hidden from every kid",
    allKids: "All kids",
    noKidsPicked: "No kids picked yet",
    titleField: "Title",
    whoCanStudy: "Who can study it",
    allMyKids: "All my kids",
    onlyThese: "Only these kids:",
    addProfilesFirst: "Add kid profiles first.",
    downloadYaml: "Download YAML",
    deleteDeck: "Delete deck",
    confirmDelete: (title: string) => `Delete "${title}"? This can't be undone.`,
    adding: (i: number, total: number) => `Adding ${num(i)} of ${num(total)}…`,
    addFailed: "Couldn't add this deck.",
    changeFailed: "Couldn't change that deck.",
    add: "+ Add YAML deck…",
    count: (n: number, max: number) => `${num(n)} of ${num(max)} decks`,
    browserOnly: (n: number) => `${num(n)} ${plural(n, "deck is", "decks are")} saved only in this browser.`,
    copyToAccount: "Copy to my account",
    empty: "No decks yet.",
    emptyHint: "Start from the template, fill in your questions, then add the file here.",
    cards: (n: number) => `${num(n)} ${plural(n, "card", "cards")}`,
    switchOffTitle: "Switch off to hide from kids",
    switchOnTitle: "Switch on",
    showToKids: (title: string) => `Show "${title}" to kids`,
    on: "On",
    editLabel: (title: string) => `Edit "${title}"`,
  },

  myFiles: {
    title: "Study files",
    intro: (size: string) =>
      `Keep your PDFs, Word documents (.docx) and pictures together, up to ${size} each. These files are private to your signed-in account; learners cannot open them.`,
    loadFailed: (message: string) => `Couldn't load your files: ${message}`,
    uploading: (name: string) => `Uploading ${name}…`,
    uploadingPercent: (name: string, percent: number) => `Uploading ${name}… ${percent}%`,
    uploadFailed: "Couldn't upload this file.",
    openFailed: "Couldn't open that file.",
    deleteFailed: "Couldn't delete that file.",
    confirmDelete: (name: string) => `Delete "${name}"? This can't be undone.`,
    upload: "+ Upload a file…",
    usage: (count: number, max: number, used: string, total: string) => `${num(count)} of ${num(max)} files · ${used} of ${total}`,
    empty: "No files yet.",
    emptyHint: "Upload worksheets, study guides or photos of notes to keep them in one place.",
    open: "Open",
    openLabel: (name: string) => `Open ${name}`,
    deleteLabel: (name: string) => `Delete ${name}`,
    types: { PDF: "PDF", Word: "Word", "PNG image": "PNG image", "JPEG image": "JPEG image", "WebP image": "WebP image" } as Record<string, string>,
    file: "File",
  },

  devSignIn: {
    title: "Local test sign-in",
    text: "This is a disposable local account, not a real sign-in.",
    parentId: "Parent test ID",
    continue: "Continue",
  },

  api: {
    offline: "Can't reach the server. Check your internet connection.",
    failed: (status: number) => `Something went wrong (${status}).`,
    noSessionTag: "This session cannot safely save points. Refresh and start a new session.",
    uploadFailed: "The upload didn't go through. Please try again.",
    openFailed: "Couldn't open that file.",
  },

  deck: deckMessagesEn,
};

export type Messages = typeof en;
