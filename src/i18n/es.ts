// Todo lo que dice la app, en español (latinoamericano neutro, tuteando).
// Debe tener exactamente la misma forma que en.ts: TypeScript lo comprueba.
//
// Vocabulario: deck = mazo, card = tarjeta, leaderboard = tabla de posiciones,
// nickname = apodo, kid/learner = estudiante (sirve para familias y docentes).
import { deckMessagesEs } from "../deck-messages";
import type { Messages } from "./en";

const num = (n: number) => n.toLocaleString("es-US");
const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);
/** A space that keeps "85" and "%" on one line. */
const NBSP = " ";

export const es: Messages = {
  languageName: "Español",
  locale: "es-US",
  language: {
    switchLabel: "Idioma",
  },

  common: {
    loading: "Cargando…",
    back: "← Volver",
    cancel: "Cancelar",
    save: "Guardar",
    edit: "Editar",
    remove: "Quitar",
    delete: "Eliminar",
    ok: "Aceptar",
    somethingWentWrong: "Algo salió mal.",
    pts: (n) => `${num(n)} pts`,
    parentSignIn: "Acceso para familias y docentes",
    uncategorized: "Sin categoría",
    imported: "Importado",
    private: "Privado",
    downloadTemplate: "Descargar plantilla",
    templateFileName: "quizzlet-plantilla-de-mazo.yaml",
    questionCount: (n) => `${num(n)} ${plural(n, "pregunta", "preguntas")}`,
  },

  app: {
    deviceUnlinked: "Este dispositivo ya no está vinculado. Pídele a un adulto un enlace nuevo.",
    deviceUnlinkedPointsLost:
      "Este dispositivo ya no está vinculado. Pídele a un adulto un enlace nuevo. Es posible que no se hayan guardado los puntos recientes.",
    profileGone: "Este perfil ya no está disponible. Pídele a un adulto que empiece una sesión nueva.",
    profileGonePointsLost:
      "Este perfil ya no está disponible. Pídele a un adulto que empiece una sesión nueva. Es posible que no se hayan guardado los puntos recientes.",
    deckGone:
      "Este mazo ya no está disponible. Es posible que no se hayan guardado tus respuestas más recientes. Los cambios de acceso solo se pueden comprobar con conexión; el contenido descargado puede quedar en este dispositivo.",
    deckCantOpen:
      "No se pudo abrir este mazo. Revisa tu conexión o pregúntale a un adulto. Los cambios de acceso solo se pueden comprobar con conexión; el contenido descargado puede quedar en este dispositivo.",
    confirmUnlinkUnsaved: "Algunos puntos recientes aún no se han confirmado. ¿Quitar este dispositivo de todos modos?",
    unlinkCancelled: "Se canceló la eliminación del dispositivo; tus puntos siguen pendientes.",
    deviceRemoved: (unconfirmed) =>
      `Se quitó este dispositivo. Pídele a un adulto un enlace nuevo para volver a estudiar con tu perfil.${unconfirmed ? " No se pudieron confirmar algunos puntos recientes." : ""}`,
    confirmSignOutUnsaved: "Algunos puntos recientes aún no se han confirmado. ¿Cerrar sesión de todos modos?",
    signOutUnconfirmed: "No se pudieron confirmar algunos puntos recientes antes de cerrar sesión.",
    accountDeleted: "Se eliminaron tu cuenta y todos sus perfiles de estudiantes.",
    sessionTimeUp: (name, points, unconfirmed, guest) =>
      `Tu sesión terminó, ${name}. ${plural(points, "Se confirmó", "Se confirmaron")} ${num(points)} ${plural(points, "punto", "puntos")}.${unconfirmed ? " No se pudieron confirmar algunos puntos recientes." : ""}${guest ? " Escribe tu apodo para empezar una sesión nueva." : ""}`,
    confirmEndUnsaved: "Es posible que algunas respuestas aún no se hayan guardado. ¿Terminar la sesión de todos modos?",
    endUnconfirmed: "No se pudieron confirmar algunos puntos recientes antes de que terminara la sesión.",
    sessionExpired: (guest) =>
      `Tu sesión terminó. Es posible que no se hayan confirmado los puntos recientes.${guest ? " Escribe tu apodo para empezar otra." : ""}`,
    scoreUnknown: "No se sabe si se guardó el puntaje.",
    importSome: (added, failures) =>
      `${added ? `${plural(added, "Se agregó", "Se agregaron")} ${num(added)}. ` : ""}No se pudo agregar ${failures.join("; ")}`,
    importAdded: (n) =>
      `${plural(n, "Se agregó", "Se agregaron")} ${num(n)} ${plural(n, "mazo", "mazos")} a los mazos privados de tu familia.`,
    previousUnconfirmed: "No se pudieron confirmar algunos puntos de la sesión anterior.",
    accountLoadFailed: (message) => `No se pudo cargar tu cuenta: ${message}`,
    signOut: "Cerrar sesión",
    signInDev: "Iniciar sesión (desarrollo local)",
    signInGoogle: "Iniciar sesión con Google",
    finish: "Terminar",
    pointsRejected: "Se rechazaron algunos puntos recientes. Termina esta sesión y empieza una nueva.",
    pointsUnconfirmed: "Algunos puntos recientes aún no se han confirmado.",
    retrySaving: "Reintentar guardar",
    saveStatus: {
      confirmed: "Puntos guardados",
      saving: "Guardando puntos…",
      unknown: "No pudimos confirmar si se guardaron tus últimos puntos",
      failed: "No se pudieron guardar tus últimos puntos",
      other: "Es posible que no se hayan guardado tus últimos puntos",
    },
  },

  welcome: {
    startFailed: "No se pudo empezar tu sesión.",
    kicker: "Un poco de curiosidad llega muy lejos",
    titleLine1: "Grandes preguntas.",
    titleLine2: "Ideas brillantes.",
    intro: "Explora un mundo de preguntas, descubre algo nuevo y aprende a tu ritmo.",
    step: "01 / EMPIEZA AQUÍ",
    entryTitle: "¿Te animas a explorar?",
    entryText: "Elige un apodo y escoge un mazo para empezar.",
    nickname: "Tu apodo",
    nicknamePlaceholder: "Por ejemplo, Nova7",
    privacyLead: "Elige con cuidado:",
    privacy: "Tu apodo aparece en la tabla de posiciones pública cuando ganas puntos. Por favor, no uses tu nombre real.",
    starting: "Empezando…",
    start: "Empezar a explorar",
    sessionLength: "Tu sesión de estudio dura 60 minutos.",
  },

  footer: {
    madeWith: "Hecho con amor {heart} en Prince Frederick, MD por {author}",
    opensInNewTab: "(se abre en una pestaña nueva)",
  },

  sessionBar: {
    label: "Tu sesión",
    pointsTitle: "Puntos ganados en esta sesión",
    lessThanAMinute: "queda menos de un minuto",
    minutesLeft: (m) => `${plural(m, "queda", "quedan")} ${num(m)} min`,
    switchProfile: "Cambiar de perfil",
    end: "Terminar sesión",
  },

  deckList: {
    title: "Explorar mazos",
    subtitle: "Encuentra algo interesante. Descubre lo que sabes.",
    importYaml: "Importar YAML…",
    search: "Buscar mazos",
    searchPlaceholder: "Buscar por título o descripción",
    subject: "Materia",
    allSubjects: "Todas las materias",
    deckLanguage: "Idioma del mazo",
    allLanguages: "Todos los idiomas",
    noMatch: "Ningún mazo coincide con esa búsqueda.",
    noMatchHint: "Prueba con otra palabra o materia.",
    noEnabled: "No hay mazos activados.",
    noEnabledHint: "Pídele a un adulto que active un mazo.",
    noDecks: "Todavía no hay mazos.",
    noDecksHint: "Pídele a un adulto que agregue un mazo, o importa uno aquí.",
    study: "Estudiar",
    studyDeck: (title) => `Estudiar ${title}`,
    problems: "Este mazo tiene problemas:",
    moreProblems: (n) => `…y ${num(n)} más`,
    hiddenCount: (n) => `${num(n)} ${plural(n, "mazo oculto (no activado)", "mazos ocultos (no activados)")}`,
    hiddenHint: "Escribe {enabled} al principio del archivo YAML para mostrar un mazo.",
    formatSummary: "Cómo escribir un mazo (formato YAML)",
    formatHelp:
      "Pon los archivos en la carpeta {decks} del proyecto (aparecen automáticamente) o importa uno aquí. Solo se muestran los mazos con {enabled}, y {answer} debe coincidir exactamente con una de las {options}.",
    templateLink: "Descargar la plantilla de mazo",
    templateLinkHint: "— un ejemplo con comentarios para copiar y completar.",
    example: `title: Mitología nórdica
description: Dioses, reinos y leyendas
language: es           # opcional: el idioma en que están escritas las tarjetas
enabled: true          # obligatorio: solo se muestran los mazos activados
shuffle: true          # mezclar el orden de las tarjetas (predeterminado: true)
shuffleOptions: true   # mezclar las opciones de respuesta (predeterminado: true)

cards:
  - question: ¿Quién es el padre de Thor?
    options:
      - Odín
      - Loki
      - Tyr
      - Balder
    answer: Odín
    explanation: Odín, el Padre de Todos, gobierna Asgard.  # opcional`,
    drop: "Suelta el archivo YAML para importarlo",
  },

  preview: {
    back: "← Volver a los mazos",
    kicker: "Tu próximo descubrimiento",
    start: "Empezar a practicar",
  },

  quiz: {
    back: "← Mazos",
    retrying: "Repasando falladas",
    progress: "Progreso",
    roundPoints: (n) => `${num(n)} ${plural(n, "punto", "puntos")} en esta ronda`,
    answered: "Preguntas respondidas",
    think: "Tómate un momento para pensar",
    hint: "Elige una respuesta o presiona una tecla numérica.",
    right: "✓ ¡Correcto!",
    wrong: "Casi… veamos la respuesta",
    answerIs: "La respuesta es {answer}.",
    youChose: (option) => `Elegiste ${option}.`,
    plusPoints: (n) => `+${num(n)} ${plural(n, "punto", "puntos")}`,
    seeResults: "Ver resultados",
    next: "Siguiente pregunta",
  },

  results: {
    perfect: "¡Todas correctas! Excelente trabajo.",
    great: "¡Buena exploración! Mira abajo lo que descubriste.",
    good: "Cada pregunta es una oportunidad para aprender algo nuevo.",
    keepGoing: "La curiosidad empieza por intentarlo. Échale otro vistazo abajo.",
    saving: (n) => `Guardando tus +${num(n)} puntos…`,
    expired: (n) =>
      `Tu sesión terminó. ${plural(n, "Se confirmó", "Se confirmaron")} ${num(n)} ${plural(n, "punto", "puntos")} en esta sesión. Es posible que no se hayan confirmado los puntos recientes, y las respuestas posteriores al fin de la sesión no se guardaron.`,
    newSession: "Empezar una sesión nueva",
    rejected: "Se rechazaron tus últimos puntos.",
    unknown: "No pudimos confirmar si se guardaron tus últimos puntos.",
    tryAgain: "Intentar de nuevo",
    pointsThisRound: "puntos en esta ronda",
    thisSession: "Esta sesión",
    allTime: "Total histórico",
    missedEyebrow: (title) => `${title} · preguntas falladas`,
    percent: (p) => `${p}${NBSP}%`,
    percentCorrect: (p) => `${p}${NBSP}% de aciertos`,
    correctOf: (correct, total) => `${num(correct)} de ${num(total)} ${plural(total, "correcta", "correctas")}`,
    practiceMissed: (n) => `Practicar las falladas (${num(n)})`,
    restart: "Reiniciar el mazo",
    exploreMore: "Explorar más mazos",
    review: "Repaso",
    correct: "Correcta",
    wrong: "Incorrecta",
    answer: "Respuesta:",
    youChose: "Elegiste:",
  },

  leaderboard: {
    title: "Tabla de posiciones",
    loadFailed: "No se pudo cargar la tabla de posiciones en este momento.",
    empty: "Todavía no hay puntos. ¡Estrena la tabla con los tuyos!",
    rank: (n) => `Puesto ${num(n)}`,
    kidProfile: "Perfil de estudiante",
    you: "Tú",
  },

  kid: {
    linkIncomplete: "Este enlace no está completo. Pídele a un adulto que te lo envíe de nuevo.",
    linkRetry: "No se pudo vincular este dispositivo. Vuelve a intentarlo con el enlace.",
    linkFailed: "No se pudo vincular este dispositivo.",
    checking: "Revisando tu enlace…",
    studyAsQuestion: (name) => `¿Estudiar como ${name}?`,
    linkExplain: (name) =>
      `Este dispositivo quedará vinculado al perfil de ${name}, para que puedas estudiar aquí y ganar puntos. No necesitas correo electrónico ni contraseña. El adulto que te invitó puede quitar este dispositivo cuando quiera.`,
    linking: "Vinculando…",
    joinAs: (name) => `Usar este dispositivo como ${name}`,
    notNow: "Ahora no",
    welcomeBack: (name) => `¡Hola de nuevo, ${name}!`,
    pointsSoFar: (n) => `${num(n)} ${plural(n, "punto", "puntos")} hasta ahora`,
    ready: "¿Te animas a otro descubrimiento? Tu sesión de estudio dura 60 minutos.",
    explore: "Explorar mazos →",
    confirmUnlink: (name) => `¿Quitar este dispositivo del perfil de ${name}? Necesitarás un enlace nuevo de un adulto.`,
    notMe: (name) => `¿No eres ${name}? Quitar este dispositivo`,
  },

  links: {
    copyFailed: "No se pudo copiar. Selecciona el enlace y cópialo tú.",
    sendTo: (name) => `Envía este enlace a ${name}.`,
    sendHow: (until) =>
      `Ábrelo en su propia tableta o computadora para vincular ese dispositivo. Funciona una sola vez, hasta el ${until}.`,
    linkFor: (name) => `Enlace de invitación para ${name}`,
    copied: "¡Copiado!",
    copy: "Copiar enlace",
    share: "Compartir…",
    shareText: (name) => `Estudia como ${name} en Quizzlet`,
    warning: (name) =>
      `Cualquier persona con este enlace puede vincular un dispositivo como ${name}, así que envíaselo solo a esa persona.`,
    waiting: (until) => `Hay un enlace esperando a que lo abran (hasta el ${until}).`,
    newLink: "Crear un enlace nuevo",
    linkDevice: "+ Vincular un dispositivo",
    cancelLink: "Cancelar enlace",
    devicesOf: (name) => `Dispositivos de ${name}`,
    removeHint:
      "Quitar un dispositivo bloquea su acceso la próxima vez que se conecte. El contenido ya descargado no se puede recuperar.",
    noDevices: "Todavía no hay dispositivos vinculados.",
    deviceDates: (linked, lastUsed, until) => `· vinculado el ${linked} · último uso el ${lastUsed} · funciona hasta el ${until}`,
    removeDeviceLabel: (device, name) => `Quitar ${device} de los dispositivos de ${name}`,
    confirmRemove: (device, name) => `¿Quitar ${device}? Dejará de estudiar como ${name}.`,
    deviceWords: {
      "Android phone": "Teléfono Android",
      "Android tablet": "Tableta Android",
      Device: "Dispositivo",
    },
  },

  parentHome: {
    startFailed: "No se pudo empezar la sesión.",
    workspace: (name) => `Espacio para familias y docentes · ${name}`,
    myDecks: "Mis mazos",
    myFiles: "Mis archivos",
    settings: "Configuración",
    title: "¿Quién explora hoy?",
    intro: "Elige a un estudiante para empezar o administra el espacio de estudio de tu familia.",
    noProfiles: "Todavía no hay perfiles de estudiantes.",
    noProfilesHint: "Crea un perfil, solo con un apodo, para cada niño o niña que estudie con Quizzlet.",
    addProfile: "Agregar un perfil",
    studyAs: "Estudiar como ",
    starting: "Empezando…",
    manage: "Administrar perfiles",
  },

  settings: {
    saved: "Guardado.",
    saveFailed: "No se pudo guardar.",
    deleteFailed: "No se pudo eliminar la cuenta.",
    title: "Configuración de la cuenta",
    yourName: "Tu nombre",
    yourNameHint: "Solo tú lo ves. Los estudiantes aparecen con el apodo de su perfil.",
    theme: "Tema",
    themes: { system: "Igual que este dispositivo", light: "Claro", dark: "Oscuro" },
    cardOrder: "Orden de las tarjetas",
    cardOrders: { deck: "Lo decide cada mazo", on: "Mezclar siempre", off: "No mezclar nunca" },
    saveSettings: "Guardar configuración",
    deleteTitle: "Eliminar mi cuenta",
    deleteText:
      "Elimina para siempre tu cuenta, todos los perfiles de estudiantes y sus puntos en la tabla de posiciones, tus mazos privados y tus archivos. No se puede deshacer.",
    deleteWord: "ELIMINAR",
    typeToConfirm: "Escribe {word} para confirmar",
    deleteButton: "Eliminar mi cuenta",
  },

  profiles: {
    title: "Perfiles de estudiantes",
    intro:
      "Cada perfil es solo un apodo y una imagen: sin nombres reales, correos electrónicos ni fechas de nacimiento. Los estudiantes eligen su perfil en este dispositivo, o abren su enlace de invitación en su propia tableta o computadora, para estudiar y ganar puntos.",
    linksFailed: (message) => `No se pudieron cargar los dispositivos vinculados: ${message}`,
    nickname: "Apodo",
    nicknamePlaceholder: "p. ej., GatoEstelar (no su nombre real)",
    grade: "Grado",
    gradeNotSet: "Sin definir",
    grades: { "k-2": "Kínder a 2.º grado", "3-5": "3.º a 5.º grado", "6-8": "6.º a 8.º grado", "9-12": "9.º a 12.º grado" },
    color: "Color",
    picture: "Imagen",
    showOnBoard: "Mostrar este apodo en la tabla de posiciones pública",
    showOnBoardHint: "(si está desactivado, el puntaje de este perfil no aparece en la tabla pública)",
    deleteProfile: "Eliminar perfil",
    confirmDelete: (name) => `¿Eliminar el perfil de ${name}? Se borrarán sus puntos.`,
    noGrade: "Grado sin definir",
    onBoard: "En la tabla de posiciones",
    devices: "Dispositivos",
    editLabel: (name) => `Editar ${name}`,
    newProfile: "Nuevo perfil",
    create: "Crear perfil",
    add: "+ Agregar un perfil",
    deviceCount: (n) =>
      n === 0 ? "Ningún dispositivo vinculado" : `${num(n)} ${plural(n, "dispositivo vinculado", "dispositivos vinculados")}`,
  },

  myDecks: {
    title: "Mazos privados",
    intro:
      "Tu colección privada se queda en tu cuenta. Elige qué estudiantes pueden ver cada mazo, o desactívalo para ocultarlo a todos.",
    off: "Desactivado: oculto para todos los estudiantes",
    allKids: "Todos los estudiantes",
    noKidsPicked: "Todavía no elegiste estudiantes",
    titleField: "Título",
    whoCanStudy: "Quién puede estudiarlo",
    allMyKids: "Todos mis estudiantes",
    onlyThese: "Solo estos estudiantes:",
    addProfilesFirst: "Primero agrega perfiles de estudiantes.",
    downloadYaml: "Descargar YAML",
    deleteDeck: "Eliminar mazo",
    confirmDelete: (title) => `¿Eliminar “${title}”? No se puede deshacer.`,
    adding: (i, total) => `Agregando ${num(i)} de ${num(total)}…`,
    addFailed: "No se pudo agregar este mazo.",
    changeFailed: "No se pudo cambiar ese mazo.",
    add: "+ Agregar mazo YAML…",
    count: (n, max) => `${num(n)} de ${num(max)} mazos`,
    browserOnly: (n) =>
      `${num(n)} ${plural(n, "mazo está guardado", "mazos están guardados")} solo en este navegador.`,
    copyToAccount: "Copiar a mi cuenta",
    empty: "Todavía no hay mazos.",
    emptyHint: "Empieza con la plantilla, completa tus preguntas y luego agrega el archivo aquí.",
    cards: (n) => `${num(n)} ${plural(n, "tarjeta", "tarjetas")}`,
    switchOffTitle: "Desactívalo para ocultarlo a los estudiantes",
    switchOnTitle: "Activar",
    showToKids: (title) => `Mostrar “${title}” a los estudiantes`,
    on: "Activo",
    editLabel: (title) => `Editar “${title}”`,
  },

  myFiles: {
    title: "Archivos de estudio",
    intro: (size) =>
      `Guarda juntos tus PDF, documentos de Word (.docx) e imágenes, de hasta ${size} cada uno. Estos archivos son privados de tu cuenta; los estudiantes no pueden abrirlos.`,
    loadFailed: (message) => `No se pudieron cargar tus archivos: ${message}`,
    uploading: (name) => `Subiendo ${name}…`,
    uploadingPercent: (name, percent) => `Subiendo ${name}… ${percent}${NBSP}%`,
    uploadFailed: "No se pudo subir este archivo.",
    openFailed: "No se pudo abrir ese archivo.",
    deleteFailed: "No se pudo eliminar ese archivo.",
    confirmDelete: (name) => `¿Eliminar “${name}”? No se puede deshacer.`,
    upload: "+ Subir un archivo…",
    storageUsed: (count, max, used, total) => `${num(count)} de ${num(max)} archivos · ${used} de ${total}`,
    empty: "Todavía no hay archivos.",
    emptyHint: "Sube hojas de ejercicios, guías de estudio o fotos de apuntes para tenerlas en un solo lugar.",
    open: "Abrir",
    openLabel: (name) => `Abrir ${name}`,
    deleteLabel: (name) => `Eliminar ${name}`,
    types: { PDF: "PDF", Word: "Word", "PNG image": "Imagen PNG", "JPEG image": "Imagen JPEG", "WebP image": "Imagen WebP" },
    file: "Archivo",
  },

  devSignIn: {
    title: "Inicio de sesión de prueba local",
    text: "Es una cuenta local desechable, no un inicio de sesión real.",
    parentId: "ID de prueba del adulto",
    continue: "Continuar",
  },

  api: {
    offline: "No se puede conectar con el servidor. Revisa tu conexión a internet.",
    failed: (status) => `Algo salió mal (${status}).`,
    noSessionTag: "Esta sesión no puede guardar puntos de forma segura. Actualiza la página y empieza una sesión nueva.",
    uploadFailed: "No se pudo subir el archivo. Inténtalo de nuevo.",
    openFailed: "No se pudo abrir ese archivo.",
  },

  deck: deckMessagesEs,
};
