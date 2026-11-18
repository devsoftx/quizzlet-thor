// The app in Spanish: picked up from the browser, chosen with the switch,
// remembered on the device, and used for what the server says too.
import type { Page } from "@playwright/test";
import { deckYaml, expect, fileName, test, unique } from "./support";

/** A Spanish deck: the same planets, in Spanish, saying which language it's in. */
const PLANETAS = [
  { question: "¿Qué planeta está más cerca del Sol?", options: ["Mercurio", "Venus", "Marte", "Tierra"], answer: "Mercurio", explanation: "Mercurio gira más cerca del Sol." },
  { question: "¿Qué planeta es conocido como el planeta rojo?", options: ["Júpiter", "Marte", "Saturno", "Neptuno"], answer: "Marte" },
];
const spanishDeck = (title: string) => JSON.stringify({ ...JSON.parse(deckYaml(title, { cards: PLANETAS })), language: "es" }, null, 2);

async function importFile(page: Page, title: string, yaml: string) {
  await page.locator('input[type="file"][accept=".yaml,.yml"]').setInputFiles({ name: fileName(title), mimeType: "text/yaml", buffer: Buffer.from(yaml) });
}

async function startGuestInSpanish(page: Page, name: string) {
  await page.getByLabel("Tu apodo").fill(name);
  await page.getByRole("button", { name: /Empezar a explorar/ }).click();
  await expect(page.getByRole("heading", { name: "Explorar mazos" })).toBeVisible();
}

test.describe("a browser set to Spanish", () => {
  test.use({ locale: "es-MX" });

  test("gets the whole learner journey in Spanish @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.getByRole("heading", { name: "¿Te animas a explorar?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Español" })).toHaveAttribute("aria-pressed", "true");

    await startGuestInSpanish(page, unique("Nova"));
    await expect(page.getByLabel("Tu sesión")).toContainText("0 pts");
    await expect(page.getByRole("button", { name: "Terminar sesión" })).toBeVisible();

    // Decks in two languages: each says its language when it isn't the app's, and they can be filtered.
    const espanol = unique("Planetas ");
    const english = unique("Planets ");
    await importFile(page, espanol, spanishDeck(espanol));
    await importFile(page, english, JSON.stringify({ ...JSON.parse(deckYaml(english)), language: "en" }));
    await expect(page.getByRole("heading", { name: english })).toHaveAttribute("lang", "en");
    await expect(page.locator(".deck", { hasText: english })).toContainText("Inglés");
    await expect(page.locator(".deck", { hasText: espanol })).not.toContainText("Español");
    await page.getByLabel("Idioma del mazo").selectOption("es");
    await expect(page.getByRole("heading", { name: english })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: espanol })).toBeVisible();

    await page.getByRole("button", { name: `Estudiar ${espanol}` }).click();
    await expect(page.getByText("2 preguntas")).toBeVisible();
    await page.getByRole("button", { name: /Empezar a practicar/ }).click();
    await expect(page.getByText("Tómate un momento para pensar")).toBeVisible();
    await expect(page.getByRole("heading", { name: PLANETAS[0].question })).toHaveAttribute("lang", "es");

    await page.locator(".options").getByRole("button", { name: "Venus", exact: true }).click();
    const feedback = page.locator(".field-feedback");
    await expect(feedback).toContainText("Casi… veamos la respuesta");
    await expect(feedback).toContainText("La respuesta es Mercurio.");
    await expect(feedback).toContainText("Elegiste Venus.");
    await page.getByRole("button", { name: /Siguiente pregunta/ }).click();
    await page.locator(".options").getByRole("button", { name: "Marte", exact: true }).click();
    await expect(feedback).toContainText("✓ ¡Correcto!");
    await expect(feedback).toContainText("+10 puntos");
    await page.getByRole("button", { name: /Ver resultados/ }).click();

    await expect(page.getByRole("heading", { name: "1 de 2 correctas" })).toBeVisible();
    await expect(page.getByRole("img", { name: "50 % de aciertos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Practicar las falladas (1)" })).toBeVisible();
    await expect(page.getByText("puntos en esta ronda")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Repaso" })).toBeVisible();

    // The switch fits on a phone without pushing the page sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("hears the server's refusals in Spanish", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Tu apodo").fill("sh1thead");
    await page.getByRole("button", { name: /Empezar a explorar/ }).click();
    await expect(page.getByRole("alert")).toHaveText("Por favor, elige otro apodo.");

    await page.getByLabel("Tu apodo").fill("Аna"); // a Cyrillic А
    await page.getByRole("button", { name: /Empezar a explorar/ }).click();
    await expect(page.getByRole("alert")).toHaveText("Por favor, usa letras de un solo alfabeto en tu apodo.");
  });

  test("reads a broken deck's problems in Spanish", async ({ page }) => {
    await page.goto("/");
    await startGuestInSpanish(page, unique("Rota"));
    const title = unique("Rota ");
    await importFile(page, title, deckYaml(title, { cards: [{ question: "¿Cuál es un planeta enano?", options: ["Tierra", "Marte"], answer: "Plutón" }] }));
    const broken = page.locator(".deck--error", { hasText: fileName(title) });
    await expect(broken).toContainText("Este mazo tiene problemas:");
    await expect(broken).toContainText('Tarjeta 1 ("¿Cuál es un planeta enano?"): la respuesta "Plutón" no es una de las opciones.');
  });
});

test.describe("the language switch", () => {
  test("changes the language on the spot, and the device remembers it", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();

    await page.getByRole("group", { name: "Language" }).getByRole("button", { name: "Español" }).click();
    await expect(page.getByRole("heading", { name: "¿Te animas a explorar?" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");

    await page.reload();
    await expect(page.getByRole("heading", { name: "¿Te animas a explorar?" })).toBeVisible();

    await page.getByRole("group", { name: "Idioma" }).getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
  });

  test("works through a parent's screens, down to deleting the account", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Español" }).click();
    await page.getByRole("button", { name: "Acceso para familias y docentes" }).click();
    const dialog = page.getByRole("dialog", { name: "Inicio de sesión de prueba local" });
    await dialog.getByLabel("ID de prueba del adulto").fill(unique("parent-"));
    await dialog.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByRole("heading", { name: "¿Quién explora hoy?" })).toBeVisible();

    await page.getByRole("button", { name: "Agregar un perfil" }).click();
    await expect(page.getByRole("heading", { name: "Perfiles de estudiantes" })).toBeVisible();
    const kid = unique("Luna");
    await page.getByLabel("Apodo", { exact: true }).fill(kid);
    await page.getByLabel("Grado").selectOption("3-5");
    await page.getByRole("button", { name: "Crear perfil" }).click();
    await expect(page.getByText(`Envía este enlace a ${kid}.`)).toBeVisible();
    await expect(page.locator(".manage__info", { hasText: kid })).toContainText("3.º a 5.º grado");

    await page.getByRole("button", { name: "← Volver" }).click();
    await page.getByRole("button", { name: "Configuración" }).click();
    await expect(page.getByRole("heading", { name: "Configuración de la cuenta" })).toBeVisible();
    const remove = page.getByRole("button", { name: "Eliminar mi cuenta" });
    await page.getByLabel("Escribe ELIMINAR para confirmar").fill("DELETE");
    await expect(remove).toBeDisabled();
    await page.getByLabel("Escribe ELIMINAR para confirmar").fill("ELIMINAR");
    await remove.click();
    await expect(page.getByText("Se eliminaron tu cuenta y todos sus perfiles de estudiantes.")).toBeVisible();
  });

  test("downloads the deck template in the chosen language", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Español" }).click();
    await page.getByLabel("Tu apodo").fill(unique("Plantilla"));
    await page.getByRole("button", { name: /Empezar a explorar/ }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".app-header__actions").getByRole("link", { name: "Descargar plantilla" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("quizzlet-plantilla-de-mazo.yaml");
    const text = await (await page.request.get("/deck-template.es.yaml")).text();
    expect(text).toContain("language: es");
    expect(text).toContain("¿Qué planeta es conocido como el planeta rojo?");
  });
});
