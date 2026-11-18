// The API answers in English. These are its messages people can see, in
// Spanish; the browser swaps them in when the app is in Spanish (src/api.ts).
// A message missing here is shown as the server wrote it.
//
// server-messages.test.ts reads the server's code and fails when a message
// shown to people has no translation, so add new ones here as you write them.

/** Messages the server always words the same way. */
const EXACT_ES: Record<string, string> = {
  // Sign-in and accounts
  "Parent accounts aren't set up yet.": "Las cuentas para familias y docentes todavía no están configuradas.",
  "Please sign in.": "Inicia sesión.",
  "Account not found.": "No se encontró la cuenta.",
  "Confirm the deletion to continue.": "Confirma la eliminación para continuar.",
  "Profile not found.": "No se encontró el perfil.",
  "Unknown grade band.": "Ese grado no existe.",
  "Unknown color.": "Ese color no existe.",
  "Unknown emoji.": "Esa imagen no existe.",
  "Something went wrong.": "Algo salió mal.",
  "This request came from another site.": "Esta solicitud vino de otro sitio.",

  // Nicknames
  "Please choose a different nickname.": "Por favor, elige otro apodo.",
  "Please choose a different name.": "Por favor, elige otro nombre.",
  "Please use letters from one alphabet in your nickname.": "Por favor, usa letras de un solo alfabeto en tu apodo.",
  "Please use letters from one alphabet in your name.": "Por favor, usa letras de un solo alfabeto en tu nombre.",
  "That nickname is taken. Please pick another one.": "Ese apodo ya está en uso. Por favor, elige otro.",

  // Sessions and points
  "The leaderboard database isn't connected yet. Ask the site owner to set up storage.":
    "La base de datos de la tabla de posiciones todavía no está conectada. Pídele a quien administra el sitio que configure el almacenamiento.",
  "No active session.": "No hay ninguna sesión activa.",
  "This deck is no longer available.": "Este mazo ya no está disponible.",
  "This device isn't linked to a profile anymore. Ask your parent for a new link.":
    "Este dispositivo ya no está vinculado a un perfil. Pídele a un adulto un enlace nuevo.",
  "This device is no longer linked. Ask an adult for a new link.":
    "Este dispositivo ya no está vinculado. Pídele a un adulto un enlace nuevo.",
  "This profile is no longer available. Ask an adult to start a new session.":
    "Este perfil ya no está disponible. Pídele a un adulto que empiece una sesión nueva.",
  "Your session has ended. Start a new one to save points.": "Tu sesión terminó. Empieza una nueva para guardar puntos.",
  "This page is out of date. Refresh it to keep saving points.": "Esta página está desactualizada. Actualízala para seguir guardando puntos.",
  "This score belongs to a different session.": "Este puntaje pertenece a otra sesión.",
  "Invalid score batch ID.": "El identificador del lote de puntos no es válido.",
  "This score batch was already used for different answers.": "Este lote de puntos ya se usó para otras respuestas.",
  "That was very fast! Wait a moment and your points will be saved.":
    "¡Qué rápido! Espera un momento y tus puntos se guardarán.",

  // Kid device links
  "Kid links aren't set up yet.": "Los enlaces para estudiantes todavía no están configurados.",
  "This link has expired or was already used. Ask your parent for a new one.":
    "Este enlace venció o ya se usó. Pídele a un adulto uno nuevo.",
  "Device not found.": "No se encontró el dispositivo.",
  "Unknown action.": "Acción desconocida.",

  // Private decks
  "Send the deck's YAML text.": "Envía el texto YAML del mazo.",
  "This deck has problems.": "Este mazo tiene problemas.",
  "Deck not found.": "No se encontró el mazo.",

  // Private files
  "File storage isn't set up yet.": "El almacenamiento de archivos todavía no está configurado.",
  "File not found.": "No se encontró el archivo.",
  "Upload a PDF, Word (.docx), PNG, JPEG or WebP file.": "Sube un archivo PDF, Word (.docx), PNG, JPEG o WebP.",
  "That file is empty.": "Ese archivo está vacío.",
  "That upload can't be saved.": "No se puede guardar esa subida.",
  "That upload took too long. Please try again.": "Esa subida tardó demasiado. Inténtalo de nuevo.",
  "The upload didn't finish. Please try again.": "La subida no terminó. Inténtalo de nuevo.",
  "That file is bigger than the one you picked. Please try again.": "Ese archivo es más grande que el que elegiste. Inténtalo de nuevo.",
  "That file type isn't allowed.": "Ese tipo de archivo no está permitido.",
  "You can't upload to that location.": "No puedes subir archivos a esa ubicación.",
};

/** Messages with a number or a name in them. */
const PATTERNS_ES: Array<[RegExp, (...parts: string[]) => string]> = [
  [/^You can have up to (\d+) profiles\.$/, (n) => `Puedes tener hasta ${n} perfiles.`],
  [/^Please enter a nickname \(up to (\d+) letters, numbers or spaces\)\.$/, (n) => `Escribe un apodo (hasta ${n} letras, números o espacios).`],
  [/^Please enter a name \(up to (\d+) letters, numbers or spaces\)\.$/, (n) => `Escribe un nombre (hasta ${n} letras, números o espacios).`],
  [/^This profile already has (\d+) devices\. Ask your parent to remove one\.$/, (n) => `Este perfil ya tiene ${n} dispositivos. Pídele a un adulto que quite uno.`],
  [/^(.+) already has (\d+) devices\. Remove one first\.$/, (name, n) => `${name} ya tiene ${n} dispositivos. Quita uno primero.`],
  [/^That deck is too big \(up to (.+)\)\.$/, (size) => `Ese mazo es demasiado grande (hasta ${size}).`],
  [/^Please enter a title \(up to (\d+) characters\)\.$/, (n) => `Escribe un título (hasta ${n} caracteres).`],
  [/^You can keep up to (\d+) decks\.$/, (n) => `Puedes guardar hasta ${n} mazos.`],
  [/^You can keep up to (\d+) files\. Delete one to make room\.$/, (n) => `Puedes guardar hasta ${n} archivos. Elimina uno para hacer espacio.`],
  [/^That would go over your (.+) of file storage\. Delete a file to make room\.$/, (size) => `Eso superaría tus ${size} de almacenamiento. Elimina un archivo para hacer espacio.`],
  [/^Files can be up to (.+), and no bigger than the file you picked\.$/, (size) => `Los archivos pueden pesar hasta ${size}, y no más que el archivo que elegiste.`],
  [/^Files can be up to (.+)\.$/, (size) => `Los archivos pueden pesar hasta ${size}.`],
];

/** A server message in the app's language (unchanged in English, or when there's no translation). */
export function translateServerMessage(message: string, language: string): string {
  if (language !== "es") return message;
  const exact = EXACT_ES[message];
  if (exact) return exact;
  for (const [pattern, render] of PATTERNS_ES) {
    const match = pattern.exec(message);
    if (match) return render(...match.slice(1));
  }
  return message;
}
