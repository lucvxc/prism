import { ApiError, NetworkError, RateLimitError } from "./errors.ts";
import { defaultFetcher, type Fetcher } from "./http.ts";
import type { ApiErrorBody } from "./types.ts";

type QueryValue = string | number | boolean | null | undefined;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: Method;
  query?: Readonly<Record<string, QueryValue>>;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeout?: number;
  retry?: "safe" | "none";
}

export interface Result<T> {
  status: number;
  data: T;
  text: string;
  headers: Headers;
}

export interface TransportOptions {
  authorization: string;
  baseUrl?: string;
  retries?: number;
  timeout?: number;
  fetcher?: Fetcher;
}

export const apiUrl = "https://discord.com/api/v10";

function parse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorBody(value: unknown): ApiErrorBody | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ApiErrorBody)
    : null;
}

function retryDelay(response: Response, body: ApiErrorBody | null): number {
  const header = response.headers.get("retry-after");
  const fromHeader = header === null ? NaN : Number(header);
  const rawBody = body?.retry_after;
  const fromBody = typeof rawBody === "string" ? Number(rawBody) : rawBody;
  if (Number.isFinite(fromHeader) && fromHeader >= 0)
    return Math.ceil(fromHeader * 1_000);
  if (typeof fromBody === "number" && Number.isFinite(fromBody) && fromBody >= 0)
    return Math.ceil(fromBody * 1_000);
  if (header) {
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return 1_000;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const timer = setTimeout(finish, Math.min(ms, 2_147_000_000));
    signal.addEventListener("abort", abort, { once: true });
  });
}

function normalizeBase(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("The API base URL must be an HTTP(S) URL without credentials or query.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export class Transport {
  readonly #base: URL;
  readonly #timeout: number;
  readonly #retries: number;
  readonly #fetcher: Fetcher;
  readonly #abort = new AbortController();
  #authorization: string;
  #closed = false;

  constructor(options: TransportOptions) {
    this.#authorization = options.authorization.trim();
    if (!this.#authorization) throw new Error("An authorization value is required.");
    this.#base = normalizeBase(options.baseUrl ?? apiUrl);
    this.#retries = Math.min(5, Math.max(0, Math.round(options.retries ?? 3)));
    this.#timeout = Math.max(1_000, options.timeout ?? 15_000);
    this.#fetcher = options.fetcher ?? defaultFetcher;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#authorization = "";
    this.#abort.abort(new Error("Client disconnected."));
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<Result<T>> {
    if (this.#closed) throw new Error("Client is disconnected.");
    if (options.body instanceof FormData)
      throw new Error("Form uploads are outside the core client API.");

    const url = this.#url(path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }

    const method = options.method ?? "GET";
    const canRetry = method === "GET" && options.retry !== "none";
    const parentSignal = options.signal
      ? AbortSignal.any([options.signal, this.#abort.signal])
      : this.#abort.signal;

    for (let attempt = 0; ; attempt++) {
      const signal = AbortSignal.any([
        parentSignal,
        AbortSignal.timeout(options.timeout ?? this.#timeout),
      ]);
      const headers = new Headers(options.headers);
      if (!headers.has("Authorization"))
        headers.set("Authorization", this.#authorization);
      if (!headers.has("Accept")) headers.set("Accept", "application/json");
      if (options.body !== undefined && !headers.has("Content-Type"))
        headers.set("Content-Type", "application/json");

      let response: Response;
      try {
        response = await this.#fetcher(url, {
          method,
          headers,
          ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
          signal,
          redirect: "error",
        });
      } catch (cause) {
        if (this.#closed) throw new Error("Client is disconnected.", { cause });
        if (options.signal?.aborted) throw cause;
        if (canRetry && attempt < this.#retries) {
          await wait(Math.min(500 * 2 ** attempt, 4_000), parentSignal);
          continue;
        }
        throw new NetworkError("API request failed.", { cause });
      }

      const text = await response.text();
      if (this.#closed) throw new Error("Client is disconnected.");
      const data = parse(text);
      const body = errorBody(data);

      if (response.status === 429) {
        const delay = retryDelay(response, body);
        if (canRetry && attempt < this.#retries) {
          await wait(delay, parentSignal);
          continue;
        }
        throw new RateLimitError(delay, body);
      }

      if (response.ok) {
        return { status: response.status, data: data as T, text, headers: response.headers };
      }
      throw new ApiError(
        body?.message ?? `API returned ${response.status}.`,
        response.status,
        body?.code ?? null,
        body,
      );
    }
  }

  #url(path: string): URL {
    if (!path || path.startsWith("//") || path.includes("\\") || path.includes("#"))
      throw new Error("Request paths must be relative to the configured API base URL.");

    const route = path.startsWith("/") ? path : `/${path}`;
    const basePath = this.#base.pathname;
    const url = new URL(`${basePath}${route}`, this.#base.origin);
    if (
      url.origin !== this.#base.origin ||
      (basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`))
    ) {
      throw new Error("Request path escaped the configured API base URL.");
    }
    return url;
  }
}
