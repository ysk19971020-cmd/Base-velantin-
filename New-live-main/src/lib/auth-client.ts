// ---------------------------------------------------------------------------
// Client-side session token handling
// ---------------------------------------------------------------------------
// The server issues a signed JWT on login/register (see src/lib/session.ts).
// We keep it in localStorage so it survives reloads, and attach it as a
// Bearer token on every authenticated request instead of ever sending a
// userId the server would have to trust blindly.
// ---------------------------------------------------------------------------

const TOKEN_KEY = "ve_session_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
}

/**
 * fetch() wrapper that attaches the stored session token as a Bearer header.
 * Use for every call to an authenticated API route.
 */
export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
