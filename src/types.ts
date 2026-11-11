import type { Fetch } from "./http.ts";

export interface Options {
  authorization: string;
  base?: string;
  path?: string;
  timeout?: number;
  retries?: number;
  fetch?: Fetch;
}

export interface Payload {
  code?: number;
  message?: string;
  retry_after?: number | string;
  [key: string]: unknown;
}
