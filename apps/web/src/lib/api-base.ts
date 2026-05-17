/**
 * Single source of truth for the API base URL used by the web app.
 *
 * Resolution order:
 * 1. `VITE_API_BASE_URL` (build/runtime env override) — useful for production
 *    deployments where the API lives on a different host.
 * 2. `http://<current-hostname>:4000` — works automatically whether the page
 *    is loaded via `localhost`, a LAN IP (e.g. from a phone), or a hostname.
 * 3. `http://localhost:4000` — fallback for non-browser contexts (SSR, tests).
 */
function resolveApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl) return envUrl;

  if (typeof window !== "undefined" && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }

  return "http://localhost:4000";
}

export const apiBaseUrl = resolveApiBaseUrl();
