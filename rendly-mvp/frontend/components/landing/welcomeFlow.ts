/** Set by /intro's Proceed: Home opens with the product film before revealing the page. */
const WELCOME_FILM_KEY = 'rendly:welcome-film';
/** The intro plays once per browser session (each new visit), not on every reload. */
const INTRO_SESSION_KEY = 'rendly:intro-session';

export function requestWelcomeFilm(): void {
  try {
    sessionStorage.setItem(INTRO_SESSION_KEY, '1');
    sessionStorage.setItem(WELCOME_FILM_KEY, '1');
  } catch {
    // Blocked storage: Home simply opens without the film.
  }
}

/** Reads and clears the hand-over flag, so a reload of Home goes straight to the page. */
export function takeWelcomeFilm(): boolean {
  try {
    const on = sessionStorage.getItem(WELCOME_FILM_KEY) === '1';
    sessionStorage.removeItem(WELCOME_FILM_KEY);
    return on;
  } catch {
    return false;
  }
}

/** Search and preview crawlers (Googlebot, Google-InspectionTool, Bingbot, Lighthouse...). */
const CRAWLER_UA = /bot\b|bot\/|crawl|spider|slurp|inspectiontool|mediapartners|lighthouse|headlesschrome/i;

/** Crawlers index Home itself; sending them to the noindex /intro would drop Home from search. */
export function isCrawler(userAgent: string): boolean {
  return CRAWLER_UA.test(userAgent);
}

/** A new visit (or `/?intro=1`) starts on /intro; deep links such as /#spark and crawlers skip it. */
export function shouldShowIntro(): boolean {
  try {
    if (isCrawler(navigator.userAgent)) return false;
    if (new URLSearchParams(window.location.search).get('intro') === '1') return true;
    if (window.location.hash) return false;
    return sessionStorage.getItem(INTRO_SESSION_KEY) !== '1';
  } catch {
    return false;
  }
}
