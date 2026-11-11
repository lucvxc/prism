# Prism

Prism is a small TypeScript REST client core for Discord. It connects with an authorization value, checks the configured identity endpoint, and gives feature packages a shared request layer. It does not bundle quests, cleanup tools, profile helpers, or other app-specific features.

## Requirements

- Node.js 20 or newer, or Bun
- TypeScript 5.7 or newer to build from source

## Install and build

```sh
npm install
npm run typecheck
npm run build
```

Or use Bun:

```sh
bun install
bun run typecheck
bun run build
```

## Connect

Pass an authorization value from an OAuth flow or another supported Discord integration. For OAuth, this is usually a bearer token:

```ts
import { Client } from "prism";

const client = new Client({
  authorization: `Bearer ${process.env.DISCORD_ACCESS_TOKEN}`,
});

const account = await client.connect();
console.log(account);
```

The default API base is `https://discord.com/api/v10`, and the default identity path is `/users/@me`. Both can be configured. The client keeps credentials in memory and clears them when disconnected.

## Add a feature module

Modules are installed by the host application. They can make requests through the client, while their feature code remains outside Prism:

```ts
import type { ClientModule } from "prism";

const feature: ClientModule = {
  name: "my-feature",
  async setup(client) {
    const result = await client.request("/some/endpoint");
    console.log(result.data);
  },
  dispose() {
    // Release timers, listeners, or other resources owned by this module.
  },
};

await client.use(feature);
```

## Scaling

Each `Client` instance owns its request state and can be disconnected independently. Prism has no global account registry or shared per-account cache; the host can create clients on demand and manage its own concurrency, storage, and lifecycle.

## Source layout

```text
src/
  client.ts     connection state and module lifecycle
  transport.ts  authenticated HTTP, timeouts, and safe retries
  modules.ts    feature module contract
  errors.ts     request error types
  http.ts       injectable fetch implementation
  types.ts      shared API error shape
  index.ts      public exports
```
