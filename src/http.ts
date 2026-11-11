export type Fetcher = typeof fetch;

export const defaultFetcher: Fetcher = (input, init) =>
  globalThis.fetch(input, init);
