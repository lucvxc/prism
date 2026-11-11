import { log } from "../log.ts";
import type { Data, Profile, Target } from "../types.ts";
import { call, type Fetch } from "./http.ts";

type Name = "web" | "windows" | "ios";

export interface Build {
  build: number;
  mobileBuild?: string;
  profiles: Partial<Record<Name, Profile>>;
  clients: { Discord: Profile };
}

const ttl = 30 * 60_000;

const socket = "https://api.sockets.lol/discord/build";
const fallback = new WeakMap<Profile, Profile>();
const scripts = /\/assets\/([a-zA-Z0-9][a-zA-Z0-9._-]{3,80})\.js/g;
const bundles = /\/assets\/((?:web|sentry|app)\.[a-zA-Z0-9._-]{4,80})\.js/g;
const patterns = [
  /"buildNumber",(\d{4,7})/,
  /build_number[^0-9]{1,5}(\d{4,7})/,
  /CLIENT_BUILD_NUMBER[^0-9]{1,5}(\d{4,7})/,
];
const age = 10 * 60_000;
const timeout = 15_000;
let store: { build: Build; loaded: number } | null = null;
let pending: Promise<{ build: Build; loaded: number }> | null = null;
let found: { number: number; loaded: number } | null = null;
let scanning: Promise<number> | null = null;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parse(value: unknown): Profile {
  const root = record(value);
  const raw = record(root?.properties);
  const build = Number(raw?.client_build_number);
  if (!raw || !Number.isFinite(build) || build <= 0)
    throw new Error("Discord client profile is invalid");
  if (typeof raw.browser_user_agent !== "string")
    throw new Error("Discord profile has no user agent");

  const decoded: Data = {
    ...raw,
    os: String(raw.os ?? "Windows"),
    browser: String(raw.browser ?? "Chrome"),
    release_channel: String(raw.release_channel ?? "stable"),
    client_version: String(raw.client_version ?? ""),
    os_version: String(raw.os_version ?? ""),
    os_arch: String(raw.os_arch ?? "x64"),
    app_arch: String(raw.app_arch ?? raw.os_arch ?? "x64"),
    system_locale: String(raw.system_locale ?? "en-US"),
    browser_user_agent: String(raw.browser_user_agent ?? ""),
    browser_version: String(raw.browser_version ?? ""),
    os_sdk_version: String(raw.os_sdk_version ?? ""),
    client_build_number: build,
    native_build_number: Number(raw.native_build_number) || 0,
    client_event_source: null,
    has_client_mods: raw.has_client_mods === true,
    client_launch_id: String(raw.client_launch_id ?? crypto.randomUUID()),
    launch_signature: String(raw.launch_signature ?? crypto.randomUUID()),
    client_app_state: String(raw.client_app_state ?? "focused"),
  };
  const encoded =
    typeof root?.encoded === "string" && root.encoded
      ? root.encoded
      : Buffer.from(JSON.stringify(raw)).toString("base64");
  return {
    encoded,
    decoded,
    extra_gateway_properties: record(root?.extra_gateway_properties),
    metadata: record(root?.metadata),
  };
}

async function json(
  url: string,
  init?: RequestInit,
  proxy?: string,
  fetcher?: Fetch,
): Promise<unknown> {
  const response = await call(
    url,
    { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) },
    fetcher,
    proxy,
  );
  if (!response.ok || response.status === 202)
    throw new Error(
      `Discord client profile request returned ${response.status}`,
    );
  return response.json();
}

async function text(
  url: string,
  proxy?: string,
  fetcher?: Fetch,
): Promise<string | null> {
  try {
    const response = await call(
      url,
      { signal: AbortSignal.timeout(timeout) },
      fetcher,
      proxy,
    );
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

function find(source: string): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    const number = Number(match?.[1]);
    if (number > 100_000) return number;
  }
  return null;
}

async function scrape(
  proxy?: string,
  fetcher?: Fetch,
): Promise<number> {
  const html = await text("https://discord.com/login", proxy, fetcher);
  if (!html) throw new Error("Could not load Discord's login page");

  const names = new Set(
    [...html.matchAll(scripts)].map((match) => match[1]!),
  );
  if (!names.size) throw new Error("Discord login page has no scripts");

  for (const name of names) {
    const source = await text(
      `https://discord.com/assets/${name}.js`,
      proxy,
      fetcher,
    );
    const number = source ? find(source) : null;
    if (number) return number;
  }

  for (const match of html.matchAll(bundles)) {
    const source = await text(
      `https://discord.com/assets/${match[1]}.js`,
      proxy,
      fetcher,
    );
    const number = source ? find(source) : null;
    if (number) return number;
  }

  throw new Error("Discord build number was not found in its scripts");
}

function fetch(proxy?: string, fetcher?: Fetch): Promise<number> {
  if (found && Date.now() - found.loaded < age)
    return Promise.resolve(found.number);
  if (!scanning) {
    scanning = scrape(proxy, fetcher)
      .then((number) => {
        found = { number, loaded: Date.now() };
        log("sb", `Scraped current Discord build (${number})`);
        return number;
      })
      .finally(() => {
        scanning = null;
      });
  }
  return scanning;
}

function stamp(profile: Profile, number: number): Profile {
  if (profile.decoded.client_build_number === number) return profile;
  const decoded = { ...profile.decoded, client_build_number: number };
  return {
    ...profile,
    decoded,
    encoded: Buffer.from(JSON.stringify(decoded)).toString("base64"),
  };
}

function web(profile: Profile, number: number): Profile {
  const decoded = {
    ...profile.decoded,
    os: "Windows",
    browser: "Chrome",
    device: "",
    client_version: "",
    os_version: "10",
    os_arch: "x64",
    app_arch: "x64",
    browser_user_agent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    browser_version: "150.0.0.0",
    os_sdk_version: "",
    client_build_number: number,
    native_build_number: 0,
    referrer: "",
    referring_domain: "",
    referrer_current: "https://discord.com/",
    referring_domain_current: "discord.com",
    client_launch_id: crypto.randomUUID(),
    launch_signature: crypto.randomUUID(),
    client_app_state: "focused",
  };
  return {
    ...profile,
    decoded,
    encoded: Buffer.from(JSON.stringify(decoded)).toString("base64"),
  };
}

async function load(
  current: Build | null,
  proxy?: string,
  fetcher?: Fetch,
): Promise<{ build: Build; loaded: number }> {
  let source: Record<string, unknown> | null = null;
  let main: Profile | null = null;
  try {
    source = record(await json(socket, undefined, proxy, fetcher));
    const clients = record(source?.clients);
    const stable = record(clients?.Discord);
    main = stable
      ? parse({ encoded: stable.encoded, properties: stable.decoded })
      : null;
  } catch {}

  const base = main ?? current?.clients.Discord;
  if (!base) throw new Error("No Discord client profile is available");
  const socketBuild = Number(source?.build);
  let number = socketBuild > 0 ? socketBuild : base.decoded.client_build_number;
  if (socketBuild <= 0) {
    try {
      number = await fetch(proxy, fetcher);
    } catch {}
  }
  main = stamp(base, number);
  const mobileBuild = Number(source?.mobileBuild) || number;
  const old = current?.profiles.ios;
  const profiles: Partial<Record<Name, Profile>> = {
    ...(current?.profiles ?? {}),
    windows: main,
    ...(old ? { ios: stamp(old, mobileBuild) } : {}),
  };
  return {
    build: {
      build: number,
      ...(mobileBuild ? { mobileBuild: String(mobileBuild) } : {}),
      profiles,
      clients: { Discord: main },
    },
    loaded: Date.now(),
  };
}

export const build = {
  client(source: Build, device: Target): Profile {
    if (device === "browser") {
      return source.profiles.web ?? web(source.clients.Discord, source.build);
    }
    if (device !== "mobile") return source.clients.Discord;
    const mobile = source.profiles.ios;
    if (!mobile) throw new Error("Mobile client profile is unavailable");
    if (mobile.decoded.browser_user_agent.trim()) return mobile;

    const userAgent = source.clients.Discord.decoded.browser_user_agent.trim();
    if (!userAgent) throw new Error("Discord client profile has no user agent");
    const cached = fallback.get(mobile);
    if (cached?.decoded.browser_user_agent === userAgent) return cached;

    log(
      "sb",
      "Mobile Discord profile has no user agent; using the loaded client profile",
    );
    const decoded = { ...mobile.decoded, browser_user_agent: userAgent };
    const result = {
      ...mobile,
      decoded,
      encoded: Buffer.from(JSON.stringify(decoded)).toString("base64"),
    };
    fallback.set(mobile, result);
    return result;
  },

  async load(
    current: Build | null,
    loaded: number,
    force: boolean,
    proxy?: string,
    fetcher?: Fetch,
  ): Promise<{ build: Build; loaded: number }> {
    if (!force && current && Date.now() - loaded <= ttl)
      return { build: current, loaded };
    if (!force && store && Date.now() - store.loaded <= ttl) return store;
    if (!force && pending) {
      try {
        return await pending;
      } catch {}
    }
    if (!pending) {
      pending = load(current, proxy, fetcher)
        .then((result) => {
          store = result;
          log(
            "sb",
            `Fetched current Discord client info (build ${result.build.build})`,
          );
          return result;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  },

  async mobile(source: Build): Promise<Build> {
    if (source.profiles.ios) return source;
    const desktop = source.clients.Discord;
    const decoded: Data = {
      os: "iOS",
      browser: "Discord iOS",
      device: "iPhone",
      release_channel: "stable",
      client_version: "268.0",
      os_version: "18.3.2",
      system_locale: desktop.decoded.system_locale,
      browser_user_agent:
        "Discord/268.0 CFNetwork/3826.500.111 Darwin/24.4.0",
      browser_version: "268.0",
      client_build_number: Number(source.mobileBuild) || source.build,
      native_build_number: 0,
      client_event_source: null,
      has_client_mods: false,
      client_launch_id: crypto.randomUUID(),
      launch_signature: crypto.randomUUID(),
      client_app_state: "focused",
    };
    const ios: Profile = {
      encoded: Buffer.from(JSON.stringify(decoded)).toString("base64"),
      decoded,
    };
    const updated = { ...source, profiles: { ...source.profiles, ios } };
    if (store?.build === source) store = { ...store, build: updated };
    return updated;
  },

  async web(
    source: Build,
    proxy?: string,
    refresh = false,
    fetcher?: Fetch,
  ): Promise<Build> {
    if (source.profiles.web && !refresh) return source;
    let number = source.build;
    try {
      number = await fetch(proxy, fetcher);
    } catch {}
    const updated = {
      ...source,
      profiles: {
        ...source.profiles,
        web: web(source.clients.Discord, number),
      },
    };
    if (store?.build === source) store = { ...store, build: updated };
    return updated;
  },
};

export type ClientBuild = Build;
