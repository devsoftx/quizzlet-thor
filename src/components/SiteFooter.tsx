import { useI18n } from "../i18n";
import { rich } from "../i18n/rich";

const AUTHOR_URL = "https://fabriciorojas.com";

/** The credit line at the bottom of the main page. */
export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <p>
        {rich(t.footer.madeWith, {
          // Decorative: the sentence already says "Love".
          heart: (
            <svg className="site-footer__heart" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
              />
            </svg>
          ),
          author: (
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
              FR.COM<span className="visually-hidden"> {t.footer.opensInNewTab}</span>
            </a>
          ),
        })}
      </p>
    </footer>
  );
}
