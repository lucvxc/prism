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

export type Device = "desktop" | "mobile";
export type Target = Device | "browser";
export type ClientDevice = Target;

export interface Data {
  os: string;
  browser: string;
  device?: string;
  release_channel: string;
  client_version: string;
  os_version: string;
  os_arch?: string;
  app_arch?: string;
  system_locale: string;
  browser_user_agent: string;
  browser_version: string;
  os_sdk_version?: string;
  client_build_number: number;
  native_build_number: number;
  client_event_source: string | null;
  has_client_mods: boolean;
  client_launch_id: string;
  launch_signature: string;
  client_app_state: string;
  [key: string]: unknown;
}

export interface Profile {
  encoded: string;
  decoded: Data;
  extra_gateway_properties?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export type ClientData = Data;
export type ClientProfile = Profile;
