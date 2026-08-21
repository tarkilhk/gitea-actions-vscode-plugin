import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { GiteaClient } from './client';

describe('GiteaClient timeouts', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server?.closeAllConnections();
      server?.close((err) => (err ? reject(err) : resolve()));
    });
    server = undefined;
  });

  it('turns AbortController timeouts into a request-timeout error', async () => {
    server = await startDelayedJsonServer(250, { ok: true });
    const { port } = server.address() as AddressInfo;
    const client = new GiteaClient({
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 80
    });

    await expect(client.getJson('/slow')).rejects.toThrow('Request timed out after 80ms');
  });
});

function startDelayedJsonServer(delayMs: number, body: unknown): Promise<Server> {
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    }, delayMs);
    void req;
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => resolve(httpServer));
  });
}
