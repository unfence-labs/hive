import { getServerUrl } from "@/hooks/useServerUrl";

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

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = headerRecord(options?.headers);
  const authToken = import.meta.env.VITE_HIVE_AUTH_TOKEN?.trim();

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
    throw new ApiError(res.status, body || res.statusText);
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
  delete: <T>(url: string, options?: RequestInit) =>
    request<T>(url, { ...options, method: "DELETE" }),
};
