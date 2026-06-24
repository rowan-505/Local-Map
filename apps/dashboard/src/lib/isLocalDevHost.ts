/**
 * True only when the dashboard is running on a local developer machine.
 *
 * - Browser: the page host is `localhost` / `127.0.0.1` / IPv6 loopback.
 * - SSR / build (no `window`): non-production `NODE_ENV` is treated as local dev.
 *
 * Used to gate localhost-only basemap fallbacks (e.g. `http://localhost:8080` tile server) so a
 * deployed dashboard never tries to fetch a developer's machine. In production the basemap must be
 * configured via public HTTPS env vars instead.
 */
export function isLocalDevHost(): boolean {
  if (typeof window === "undefined") {
    return process.env.NODE_ENV !== "production";
  }
  const host = window.location.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}
