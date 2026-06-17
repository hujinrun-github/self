import type { APIError } from "./types";

let csrfToken = "";

export class APIRequestError extends Error {
  readonly status: number;
  fields?: Record<string, string>;

  constructor(status: number, payload: APIError) {
    super(payload.error.message);
    this.name = "APIRequestError";
    this.status = status;
    this.fields = payload.error.fields;
  }
}

export function setCSRFToken(token: string) {
  csrfToken = token;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (isUnsafe(method) && path.startsWith("/api/admin") && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const payload = (await response.json()) as APIError;
    throw new APIRequestError(response.status, payload);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function isUnsafe(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}
