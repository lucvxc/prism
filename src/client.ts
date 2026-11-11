import {
  Transport,
  type RequestOptions,
  type Result,
} from "./transport.ts";
import type { ClientModule } from "./modules.ts";
import type { Fetcher } from "./http.ts";

export interface ClientOptions {
  authorization: string;
  baseUrl?: string;
  identityPath?: string;
  timeout?: number;
  retries?: number;
  fetcher?: Fetcher;
}

export type ClientState = "idle" | "connected" | "closed";

interface ModuleEntry {
  module: ClientModule;
  ready: Promise<void>;
  disposing?: Promise<void>;
}

export class Client {
  readonly #api: Transport;
  readonly #identityPath: string;
  readonly #modules = new Map<string, ModuleEntry>();
  #state: ClientState = "idle";
  #identity: unknown;
  #connecting: Promise<unknown> | null = null;

  constructor(options: ClientOptions) {
    this.#api = new Transport(options);
    this.#identityPath = options.identityPath ?? "/users/@me";
  }

  get state(): ClientState {
    return this.#state;
  }

  get connected(): boolean {
    return this.#state === "connected";
  }

  get identity(): unknown {
    return this.#identity;
  }

  async connect<T = Record<string, unknown>>(): Promise<T> {
    this.#assertOpen();
    if (this.connected) return this.#identity as T;
    if (this.#connecting) return this.#connecting as Promise<T>;

    const pending = this.request<T>(this.#identityPath).then(({ data }) => {
      this.#assertOpen();
      this.#identity = data;
      this.#state = "connected";
      return data;
    });
    this.#connecting = pending;
    try {
      return await pending;
    } finally {
      if (this.#connecting === pending) this.#connecting = null;
    }
  }

  request<T>(path: string, options?: RequestOptions): Promise<Result<T>> {
    this.#assertOpen();
    return this.#api.request(path, options);
  }

  async use<T extends ClientModule>(module: T): Promise<T> {
    this.#assertOpen();
    const name = module.name.trim();
    if (!name) throw new Error("A module needs a name.");
    if (this.#modules.has(name)) throw new Error(`Module already added: ${name}`);

    const entry: ModuleEntry = { module, ready: Promise.resolve() };
    this.#modules.set(name, entry);
    entry.ready = Promise.resolve()
      .then(() => module.setup?.(this))
      .then(() => {
        this.#assertOpen();
      })
      .catch(async (error: unknown) => {
        if (this.#modules.get(name) === entry) this.#modules.delete(name);
        await this.#dispose(entry);
        throw error;
      });
    await entry.ready;
    return module;
  }

  module<T extends ClientModule = ClientModule>(name: string): T | undefined {
    return this.#modules.get(name)?.module as T | undefined;
  }

  async remove(name: string): Promise<boolean> {
    const entry = this.#modules.get(name);
    if (!entry) return false;
    this.#modules.delete(name);
    await entry.ready.catch(() => undefined);
    await this.#dispose(entry);
    return true;
  }

  async disconnect(): Promise<void> {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#identity = undefined;
    this.#api.close();

    const entries = [...this.#modules.values()];
    this.#modules.clear();
    await Promise.allSettled(
      entries.map(async (entry) => {
        await entry.ready.catch(() => undefined);
        await this.#dispose(entry);
      }),
    );
  }

  #dispose(entry: ModuleEntry): Promise<void> {
    entry.disposing ??= Promise.resolve()
      .then(() => entry.module.dispose?.())
      .then(() => undefined);
    return entry.disposing;
  }

  #assertOpen(): void {
    if (this.#state === "closed") throw new Error("Client is disconnected.");
  }
}

