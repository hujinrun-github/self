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
  const response = await fetchWithAdminHeaders(path, method, init);
  if (response.ok) {
    return responseBody<T>(response);
  }

  const payload = (await response.json()) as APIError;
  if (shouldRefreshCSRF(path, method, response.status, payload) && (await refreshCSRFToken())) {
    const retryResponse = await fetchWithAdminHeaders(path, method, init);
    if (retryResponse.ok) {
      return responseBody<T>(retryResponse);
    }
    throw new APIRequestError(retryResponse.status, (await retryResponse.json()) as APIError);
  }

  throw new APIRequestError(response.status, payload);
}

function fetchWithAdminHeaders(path: string, method: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (isUnsafe(method) && path.startsWith("/api/admin") && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  return fetch(path, {
    ...init,
    method,
    headers,
    credentials: "include",
  });
}

async function responseBody<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function shouldRefreshCSRF(path: string, method: string, status: number, payload: APIError) {
  return (
    status === 403 &&
    isUnsafe(method) &&
    path.startsWith("/api/admin") &&
    payload.error.code === "forbidden" &&
    payload.error.message === "Invalid CSRF token"
  );
}

async function refreshCSRFToken() {
  try {
    const response = await fetch("/api/admin/csrf", { credentials: "include" });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as { csrf_token?: string };
    if (!payload.csrf_token) {
      return false;
    }
    setCSRFToken(payload.csrf_token);
    return true;
  } catch {
    return false;
  }
}

function isUnsafe(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}
