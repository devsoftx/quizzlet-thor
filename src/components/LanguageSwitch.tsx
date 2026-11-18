import { LANGUAGES, messagesFor, useI18n } from "../i18n";

/**
 * English / Español, on every screen. Each name is written in its own language
 * (and marked so), so someone who can't read the current one still finds theirs.
 */
export function LanguageSwitch() {
  const { language, t, setLanguage } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t.language.switchLabel}>
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          className="lang-switch__option"
          aria-pressed={code === language}
          onClick={() => setLanguage(code)}
        >
          {messagesFor(code).languageName}
        </button>
      ))}
    </div>
  );
}
