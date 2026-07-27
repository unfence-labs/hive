import { getAuthToken, getServerUrl } from "@/hooks/useConnection";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function headerRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === target);
}

function errorMessageFromResponseBody(body: string, fallback: string): string {
  if (!body.trim()) return fallback;

  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === "string" && parsed.trim()) return parsed;
    if (typeof parsed === "object" && parsed !== null) {
      const { error, message } = parsed as { error?: unknown; message?: unknown };
      if (typeof error === "string" && error.trim()) return error;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    // Plain text error responses are already display-ready.
  }

  return body;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = headerRecord(options?.headers);
  const authToken = getAuthToken();

  if (options?.body && !hasHeader(headers, "Content-Type")) {
    headers["Content-Type"] = "application/json";
  }
  if (authToken && !hasHeader(headers, "Authorization") && !hasHeader(headers, "x-hive-token")) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const base = getServerUrl();
  const res = await fetch(`${base}${url}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, errorMessageFromResponseBody(body, res.statusText));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(url: string, options?: RequestInit) => request<T>(url, options),
  post: <T>(url: string, body?: unknown, options?: RequestInit) =>
    request<T>(url, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : options?.body,
    }),
  put: <T>(url: string, body?: unknown, options?: RequestInit) =>
    request<T>(url, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : options?.body,
    }),
  patch: <T>(url: string, body?: unknown, options?: RequestInit) =>
    request<T>(url, {
      ...options,
      method: "PATCH",
      body: body ? JSON.stringify(body) : options?.body,
    }),
  delete: <T>(url: string, options?: RequestInit) =>
    request<T>(url, { ...options, method: "DELETE" }),
};
