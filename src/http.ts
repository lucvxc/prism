export type Fetch = typeof fetch;

export const fetcher: Fetch = (input, init) => globalThis.fetch(input, init);
