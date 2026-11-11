import type { Client } from "./client.ts";

export interface Module {
  readonly name: string;
  setup?(client: Client): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
