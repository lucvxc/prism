import { Api, Network, Throttle } from "./errors.ts";
import { fetcher, type Fetch } from "./http.ts";
import type { Options, Payload } from "./types.ts";

type Value = string | number | boolean | null | undefined;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Request {
  method?: Method;
  query?: Readonly<Record<string, Value>>;
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

export const endpoint = "https://discord.com/api/v10";

function parse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function body(value: unknown): Payload | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Payload)
    : null;
}

function delay(response: Response, data: Payload | null): number {
  const header = response.headers.get("retry-after");
  const head = header === null ? NaN : Number(header);
  const raw = data?.retry_after;
  const back = typeof raw === "string" ? Number(raw) : raw;
  if (Number.isFinite(head) && head >= 0) return Math.ceil(head * 1_000);
  if (typeof back === "number" && Number.isFinite(back) && back >= 0)
    return Math.ceil(back * 1_000);
  if (header) {
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return 1_000;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const done = () => {
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      reject(signal.reason);
    };
    const timer = setTimeout(done, Math.min(ms, 2_147_000_000));
    signal.addEventListener("abort", stop, { once: true });
  });
}

function base(value: string): URL {
  const root = new URL(value);
  if (
    !["http:", "https:"].includes(root.protocol) ||
    root.username ||
    root.password ||
    root.search ||
    root.hash
  ) {
    throw new Error("Base must be an HTTP(S) URL without credentials or query.");
  }
  root.pathname = root.pathname.replace(/\/+$/, "");
  return root;
}

export class Transport {
  readonly #base: URL;
  readonly #timeout: number;
  readonly #retries: number;
  readonly #fetch: Fetch;
  readonly #abort = new AbortController();
  #auth: string;
  #closed = false;

  constructor(
    options: Pick<
      Options,
      "authorization" | "base" | "timeout" | "retries" | "fetch"
    >,
  ) {
    this.#auth = options.authorization.trim();
    if (!this.#auth) throw new Error("Authorization is required.");
    this.#base = base(options.base ?? endpoint);
    this.#retries = Math.min(5, Math.max(0, Math.round(options.retries ?? 3)));
    this.#timeout = Math.max(1_000, options.timeout ?? 15_000);
    this.#fetch = options.fetch ?? fetcher;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#auth = "";
    this.#abort.abort(new Error("Client disconnected."));
  }

  async request<T>(path: string, options: Request = {}): Promise<Result<T>> {
    if (this.#closed) throw new Error("Client is disconnected.");
    if (typeof FormData !== "undefined" && options.body instanceof FormData)
      throw new Error("Form uploads are outside the core client API.");

    const target = this.#route(path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== null && value !== undefined)
        target.searchParams.set(key, String(value));
    }

    const method = options.method ?? "GET";
    const retry = method === "GET" && options.retry !== "none";
    const outer = options.signal
      ? AbortSignal.any([options.signal, this.#abort.signal])
      : this.#abort.signal;

    for (let attempt = 0; ; attempt++) {
      const signal = AbortSignal.any([
        outer,
        AbortSignal.timeout(options.timeout ?? this.#timeout),
      ]);
      const headers = new Headers(options.headers);
      if (!headers.has("Authorization")) headers.set("Authorization", this.#auth);
      if (!headers.has("Accept")) headers.set("Accept", "application/json");
      if (options.body !== undefined && !headers.has("Content-Type"))
        headers.set("Content-Type", "application/json");

      let response: Response;
      try {
        response = await this.#fetch(target, {
          method,
          headers,
          ...(options.body !== undefined
            ? { body: JSON.stringify(options.body) }
            : {}),
          signal,
          redirect: "error",
        });
      } catch (cause) {
        if (this.#closed) throw new Error("Client is disconnected.", { cause });
        if (options.signal?.aborted) throw cause;
        if (retry && attempt < this.#retries) {
          await wait(Math.min(500 * 2 ** attempt, 4_000), outer);
          continue;
        }
        throw new Network("API request failed.", { cause });
      }

      const text = await response.text();
      if (this.#closed) throw new Error("Client is disconnected.");
      const data = parse(text);
      const issue = body(data);

      if (response.status === 429) {
        const retry = delay(response, issue);
        if (
          method === "GET" &&
          options.retry !== "none" &&
          attempt < this.#retries
        ) {
          await wait(retry, outer);
          continue;
        }
        throw new Throttle(retry, issue);
      }

      if (response.ok) {
        return {
          status: response.status,
          data: data as T,
          text,
          headers: response.headers,
        };
      }
      throw new Api(
        issue?.message ?? `API returned ${response.status}.`,
        response.status,
        issue?.code ?? null,
        issue,
      );
    }
  }

  #route(path: string): URL {
    if (
      !path ||
      path.startsWith("//") ||
      path.includes("\\") ||
      path.includes("#")
    )
      throw new Error("Path must be relative to the configured API base.");

    const route = path.startsWith("/") ? path : `/${path}`;
    const root = this.#base.pathname;
    const target = new URL(`${root}${route}`, this.#base.origin);
    if (
      target.origin !== this.#base.origin ||
      (root && target.pathname !== root && !target.pathname.startsWith(`${root}/`))
    ) {
      throw new Error("Path escaped the configured API base.");
    }
    return target;
  }
}
