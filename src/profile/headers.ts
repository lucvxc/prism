import type { Device, Profile } from "../types.ts";

export interface Headers {
  token: string;
  referer: string;
  context: boolean;
  device: Device;
  client: Profile;
  fingerprint: string;
  cookie: string;
  clientId: string;
  installId: string;
  launchId: string;
  launchSignature: string;
  heartbeatId: string;
}

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function props(options: Headers): string {
  const properties = {
    ...options.client.decoded,
    client_launch_id: options.launchId,
    launch_signature: options.launchSignature,
    client_heartbeat_session_id: options.heartbeatId,
    ...(options.device === "desktop"
      ? { installation_id: options.installId }
      : {}),
  };
  return Buffer.from(JSON.stringify(properties)).toString("base64");
}

function hints(userAgent: string): Record<string, string> {
  const version =
    userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] ??
    userAgent.match(/Chrome\/(\d+)/)?.[1];
  if (!version) return {};
  const major = version.split(".")[0] ?? version;
  const full = version.includes(".") ? version : `${major}.0.0.0`;
  return {
    "Sec-Ch-Ua": `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not A(Brand";v="24"`,
    "Sec-Ch-Ua-Full-Version-List": `"Chromium";v="${full}", "Google Chrome";v="${full}", "Not A(Brand";v="24.0.0.0"`,
  };
}

export const headers = {
  create(options: Headers): Record<string, string> {
    const { client, device } = options;
    const profile = client.decoded;
    const result: Record<string, string> = {
      Authorization: options.token,
      "X-Super-Properties": props(options),
      "X-Fingerprint": options.fingerprint,
      Cookie: options.cookie,
      "X-Client-Id": options.clientId,
      "X-Client-Trace-Id": crypto.randomUUID(),
      "X-Installation-Id": options.installId,
      "X-Debug-Options": "bugReporterEnabled",
      "X-Discord-Locale": profile.system_locale,
      "X-Discord-Timezone": zone,
      "User-Agent": profile.browser_user_agent,
      Accept: "*/*",
      "Accept-Language": `${profile.system_locale},en;q=0.9`,
      "Accept-Encoding": "gzip, deflate, br, zstd",
    };

    if (device !== "mobile") {
      Object.assign(result, {
        Origin: "https://discord.com",
        Referer: options.referer,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": `"${profile.os}"`,
        ...hints(profile.browser_user_agent),
      });
    }

    if (options.context) {
      result["X-Context-Properties"] = Buffer.from(
        JSON.stringify({ location: "Chat Input" }),
      ).toString("base64");
    }
    return result;
  },
};

export type HeaderOptions = Headers;
