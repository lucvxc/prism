import type { ApiErrorBody } from "./types.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly body: ApiErrorBody | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class RateLimitError extends ApiError {
  constructor(
    readonly retryAfter: number,
    body: ApiErrorBody | null,
  ) {
    super(`API rate limit reached; retry after ${retryAfter} ms.`, 429, body?.code ?? null, body);
    this.name = "RateLimitError";
  }
}

export class NetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
  }
}
