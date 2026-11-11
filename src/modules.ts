import type { Client } from "./client.ts";

export interface ClientModule {
  readonly name: string;
  setup?(client: Client): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
