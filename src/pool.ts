import { Client } from "./client.ts";
import type { Options } from "./types.ts";

export interface Outcome {
  id: string;
  ok: boolean;
  error?: unknown;
}

export class Pool {
  readonly #clients = new Map<string, Client>();
  readonly #capacity: number;
  #closed = false;
  #batch: Promise<Outcome[]> | null = null;
  #stopping: Promise<void> | null = null;

  constructor(capacity = 10_000) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100_000)
      throw new Error("Capacity must be an integer from 1 to 100,000.");
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#clients.size;
  }

  get closed(): boolean {
    return this.#closed;
  }

  add(id: string, options: Options): Client {
    this.#open();
    const key = id.trim();
    if (!key) throw new Error("An id is required.");
    if (this.#clients.has(key)) throw new Error(`Client already exists: ${key}`);
    if (this.size >= this.#capacity) throw new Error("Pool capacity reached.");

    const client = new Client(options);
    this.#clients.set(key, client);
    return client;
  }

  get(id: string): Client | undefined {
    return this.#clients.get(id.trim());
  }

  async drop(id: string): Promise<boolean> {
    const key = id.trim();
    const client = this.#clients.get(key);
    if (!client) return false;
    this.#clients.delete(key);
    await client.disconnect();
    return true;
  }

  connect(id: string): Promise<unknown> {
    this.#open();
    const client = this.get(id);
    if (!client) throw new Error(`Unknown client: ${id}`);
    return client.connect();
  }

  async connectAll(workers = 32): Promise<Outcome[]> {
    this.#open();
    if (this.#batch) return this.#batch;

    const task = this.#connect([...this.#clients], this.#workers(workers));
    this.#batch = task;

    try {
      return await task;
    } finally {
      if (this.#batch === task) this.#batch = null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.#stopping) return this.#stopping;
    if (this.#closed) return;
    this.#closed = true;
    const clients = [...this.#clients.values()];
    this.#clients.clear();

    this.#stopping = Promise.all([
      this.#each(clients, 32, (client) => client.disconnect()),
      this.#batch?.then(() => undefined, () => undefined) ?? Promise.resolve(),
    ]).then(() => undefined);
    await this.#stopping;
  }

  async #connect(
    entries: [string, Client][],
    workers: number,
  ): Promise<Outcome[]> {
    const results = new Array<Outcome>(entries.length);
    await this.#each(entries, workers, async ([id, client], index) => {
      try {
        await client.connect();
        results[index] = { id, ok: true };
      } catch (error) {
        results[index] = { id, ok: false, error };
      }
    });
    return results;
  }

  async #each<T>(
    items: T[],
    workers: number,
    job: (item: T, index: number) => Promise<void>,
  ): Promise<void> {
    let next = 0;
    const run = async () => {
      while (next < items.length) {
        const index = next++;
        try {
          await job(items[index]!, index);
        } catch {
          // One client's cleanup or task must not stop the rest.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(workers, items.length) }, () => run()),
    );
  }

  #workers(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.min(64, Math.max(1, Math.floor(value)));
  }

  #open(): void {
    if (this.#closed) throw new Error("Pool is disconnected.");
  }
}
