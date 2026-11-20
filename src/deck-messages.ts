// What's wrong with a deck file, in each language the app speaks.
//
// Shared by the browser and the server (server/library-handlers.ts parses
// uploaded decks too), so this file must stay free of React and browser APIs.
// The server always answers in English; the browser re-reads a refused deck's
// YAML with the learner's language to show the same problems in it.

export interface DeckMessages {
  invalidYaml: (detail: string) => string;
  needsCards: string;
  cardsEmpty: string;
  subjectInvalid: string;
  languageInvalid: (got: string) => string;
  enabledInvalid: (got: string) => string;
  /** `where` is null for the deck's own difficulty, or a card ("Card 3 (…)"). */
  difficultyInvalid: (where: string | null, got: string) => string;
  /** "Card 3" */
  card: (n: number) => string;
  /** "Card 3 ("What is…")": where a problem is, once the card has a question. */
  cardWithQuestion: (card: string, question: string) => string;
  notAMapping: (card: string) => string;
  missingQuestion: (card: string) => string;
  needsOptions: (where: string) => string;
  optionEmpty: (where: string, n: number) => string;
  optionTwice: (where: string, option: string) => string;
  missingAnswer: (where: string) => string;
  answerNotAnOption: (where: string, answer: string) => string;
  /** The title of a deck whose file name gives nothing to go on. */
  untitled: string;
}

export const deckMessagesEn: DeckMessages = {
  invalidYaml: (detail) => `Invalid YAML: ${detail}`,
  needsCards: 'The file needs a "cards:" list.',
  cardsEmpty: '"cards" is empty — add at least one card.',
  subjectInvalid: '"subject" must be nonempty text of at most 80 characters.',
  languageInvalid: (got) => `"language" must be a language code such as en or es (got "${got}").`,
  enabledInvalid: (got) => `"enabled" must be true or false (got "${got}").`,
  difficultyInvalid: (where, got) => `${where ? `${where}: ` : ""}"difficulty" must be easy, medium or hard (got "${got}").`,
  card: (n) => `Card ${n}`,
  cardWithQuestion: (card, question) => `${card} ("${question}")`,
  notAMapping: (card) => `${card}: expected a mapping with question, options and answer.`,
  missingQuestion: (card) => `${card}: missing "question".`,
  needsOptions: (where) => `${where}: "options" must be a list with at least 2 items.`,
  optionEmpty: (where, n) => `${where}: option ${n} is empty or not plain text.`,
  optionTwice: (where, option) => `${where}: option "${option}" appears twice.`,
  missingAnswer: (where) => `${where}: missing "answer".`,
  answerNotAnOption: (where, answer) => `${where}: answer "${answer}" is not one of the options.`,
  untitled: "Untitled deck",
};

// YAML keys (cards, options, answer…) stay in English: they are what the file must say.
export const deckMessagesEs: DeckMessages = {
  invalidYaml: (detail) => `El YAML no es válido: ${detail}`,
  needsCards: 'El archivo necesita una lista "cards:".',
  cardsEmpty: '"cards" está vacía: agrega al menos una tarjeta.',
  subjectInvalid: '"subject" debe ser un texto no vacío de 80 caracteres como máximo.',
  languageInvalid: (got) => `"language" debe ser un código de idioma como en o es (se encontró "${got}").`,
  enabledInvalid: (got) => `"enabled" debe ser true o false (se encontró "${got}").`,
  difficultyInvalid: (where, got) => `${where ? `${where}: ` : ""}"difficulty" debe ser easy, medium o hard (se encontró "${got}").`,
  card: (n) => `Tarjeta ${n}`,
  cardWithQuestion: (card, question) => `${card} ("${question}")`,
  notAMapping: (card) => `${card}: se esperaba un bloque con question, options y answer.`,
  missingQuestion: (card) => `${card}: falta "question".`,
  needsOptions: (where) => `${where}: "options" debe ser una lista con al menos 2 elementos.`,
  optionEmpty: (where, n) => `${where}: la opción ${n} está vacía o no es texto simple.`,
  optionTwice: (where, option) => `${where}: la opción "${option}" aparece dos veces.`,
  missingAnswer: (where) => `${where}: falta "answer".`,
  answerNotAnOption: (where, answer) => `${where}: la respuesta "${answer}" no es una de las opciones.`,
  untitled: "Mazo sin título",
};
