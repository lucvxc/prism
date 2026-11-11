export interface Init extends RequestInit {
  proxy?: string;
  impersonate?: string;
  defaultHeaders?: boolean;
}

export type Fetch = (
  input: string | URL,
  init?: Init,
) => Promise<Response>;

function native(input: string | URL, init?: Init): Promise<Response> {
  const { proxy, impersonate, defaultHeaders, ...request } = init ?? {};
  void impersonate;
  void defaultHeaders;
  if (proxy) {
    throw new Error(
      "A profile proxy requires a custom ProfileFetch implementation.",
    );
  }
  return globalThis.fetch(input, request);
}

export function call(
  input: string | URL,
  init: RequestInit | undefined,
  fetcher: Fetch | undefined,
  proxy?: string,
  impersonate?: string,
): Promise<Response> {
  if (!fetcher && !proxy) return native(input, init);

  const request: Init = {
    ...init,
    ...(proxy ? { proxy } : {}),
    ...(fetcher
      ? {
          impersonate: impersonate ?? "chrome150",
          defaultHeaders: false,
        }
      : {}),
  };
  return (fetcher ?? native)(input, request);
}

export type ProfileFetch = Fetch;
export type ProfileInit = Init;
