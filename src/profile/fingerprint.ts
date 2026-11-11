import { log } from "../log.ts";
import { call, type Fetch } from "./http.ts";

const api = "https://discord.com/api/v9";
const timeout = 15_000;

function cookies(current: string, headers: Headers): string {
  const response = headers as Headers & { getSetCookie?: () => string[] };
  const lines = response.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
  const cookies = new Map(
    current
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const split = item.indexOf("=");
        return [item.slice(0, split), item.slice(split + 1)] as const;
      }),
  );

  for (const line of lines.flatMap((value) =>
    value.split(/,\s*(?=[^;,\s]+=)/),
  )) {
    const [pair, ...attributes] = line.split(";");
    const split = pair?.indexOf("=") ?? -1;
    if (split <= 0) continue;
    const name = pair!.slice(0, split).trim();
    const value = pair!.slice(split + 1).trim();
    if (attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute))) {
      cookies.delete(name);
    } else {
      cookies.set(name, value);
    }
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

export const fingerprint = {
  async fetch(
    agent: string,
    impersonate: string,
    proxy?: string,
    fetcher?: Fetch,
  ): Promise<{ fingerprint: string; cookie: string }> {
    const init = {
      headers: { "user-agent": agent },
      signal: AbortSignal.timeout(timeout),
    };
    const home = await call(
      "https://discord.com",
      init,
      fetcher,
      proxy,
      impersonate,
    );
    let cookie = cookies("", home.headers);
    const response = await call(
      `${api}/experiments`,
      { ...init, headers: { "user-agent": agent, cookie } },
      fetcher,
      proxy,
      impersonate,
    );
    if (!response.ok)
      throw new Error(`Fingerprint request returned ${response.status}`);
    const data = (await response.json()) as { fingerprint?: unknown };
    if (typeof data.fingerprint !== "string" || !data.fingerprint)
      throw new Error("Discord returned no fingerprint");
    cookie = cookies(cookie, response.headers);
    log("sb", "Fetched a new Discord fingerprint");
    return { fingerprint: data.fingerprint, cookie };
  },
};
