/**
 * The sub-path the app is served under (e.g. "/rendly.app" for
 * https://anoryxtechsolutions.com/rendly.app). Empty when served at the root.
 *
 * next/link, the router and CSS imports add it automatically; raw strings such as <img src>,
 * <video src>, window.location and new Audio() do not, so wrap those with withBasePath().
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');

/** Prefix an app-absolute path ("/images/x.png") with the base path. Other values pass through. */
export function withBasePath(path: string): string {
  if (!BASE_PATH || !path.startsWith('/') || path.startsWith('//')) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}
