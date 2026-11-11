import type { Payload } from "./types.ts";

export class Api extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly body: Payload | null,
  ) {
    super(message);
    this.name = "Api";
  }
}

export class Throttle extends Api {
  constructor(
    readonly retry: number,
    body: Payload | null,
  ) {
    super(
      `Rate limit reached; retry after ${retry} ms.`,
      429,
      body?.code ?? null,
      body,
    );
    this.name = "Throttle";
  }
}

export class Network extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Network";
  }
}
