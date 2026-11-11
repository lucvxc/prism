import type { Request, Result } from "./transport.ts";
import { Transport } from "./transport.ts";
import type { Module } from "./modules.ts";
import type { Options } from "./types.ts";

export type State = "idle" | "connected" | "closed";

interface Entry {
  module: Module;
  ready: Promise<void>;
  disposing?: Promise<void>;
}

export class Client {
  readonly #transport: Transport;
  readonly #path: string;
  readonly #modules = new Map<string, Entry>();
  #state: State = "idle";
  #identity: unknown;
  #connecting: Promise<unknown> | null = null;
  #stopping: Promise<void> | null = null;

  constructor(options: Options) {
    this.#transport = new Transport(options);
    this.#path = options.path ?? "/users/@me";
  }

  get state(): State {
    return this.#state;
  }

  get connected(): boolean {
    return this.#state === "connected";
  }

  get identity(): unknown {
    return this.#identity;
  }

  async connect<T = Record<string, unknown>>(): Promise<T> {
    this.#open();
    if (this.connected) return this.#identity as T;
    if (this.#connecting) return this.#connecting as Promise<T>;

    const pending = this.request<T>(this.#path).then(({ data }) => {
      this.#open();
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

  request<T>(path: string, options?: Request): Promise<Result<T>> {
    this.#open();
    return this.#transport.request(path, options);
  }

  async use<T extends Module>(module: T): Promise<T> {
    this.#open();
    const name = module.name.trim();
    if (!name) throw new Error("A module needs a name.");
    if (this.#modules.has(name)) throw new Error(`Module already added: ${name}`);

    const entry: Entry = { module, ready: Promise.resolve() };
    this.#modules.set(name, entry);
    entry.ready = Promise.resolve()
      .then(() => module.setup?.(this))
      .then(() => this.#open())
      .catch(async (error: unknown) => {
        if (this.#modules.get(name) === entry) this.#modules.delete(name);
        await this.#dispose(entry);
        throw error;
      });
    await entry.ready;
    return module;
  }

  module<T extends Module = Module>(name: string): T | undefined {
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
    if (this.#stopping) return this.#stopping;
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#identity = undefined;
    this.#transport.close();

    const entries = [...this.#modules.values()];
    this.#modules.clear();
    this.#stopping = Promise.allSettled(
      entries.map(async (entry) => {
        await entry.ready.catch(() => undefined);
        await this.#dispose(entry);
      }),
    ).then(() => undefined);
    await this.#stopping;
  }

  #dispose(entry: Entry): Promise<void> {
    entry.disposing ??= Promise.resolve()
      .then(() => entry.module.dispose?.())
      .then(() => undefined);
    return entry.disposing;
  }

  #open(): void {
    if (this.#state === "closed") throw new Error("Client is disconnected.");
  }
}
