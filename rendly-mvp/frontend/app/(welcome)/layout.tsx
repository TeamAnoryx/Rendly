/**
 * Groups Home (`/`) and the intro (`/intro`) under one layout with no loading boundary, so going
 * from the intro to Home keeps the intro on screen until Home is ready instead of flashing the
 * root skeleton (app/loading.tsx). URLs are unchanged: route groups do not add a path segment.
 */
export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
