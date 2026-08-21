import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { JOBS_TIMEOUT_MS } from '../config/constants';
import { GiteaApi } from './api';
import { GiteaClient } from './client';
import { RepoRef } from './models';

const mockRepo: RepoRef = {
  host: '127.0.0.1',
  owner: 'acme',
  name: 'demo'
};

const gitea27JobsPayload = {
  total_count: 1,
  jobs: [
    {
      id: 42,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      steps: [{ name: 'checkout', number: 1, status: 'completed', conclusion: 'success' }]
    }
  ]
};

describe('listJobs timeout against slower Gitea 1.27+ jobs API', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await closeServer(server);
    server = undefined;
  });

  it(
    'still loads jobs when Gitea takes longer than 4s because steps are included',
    async () => {
      const delayMs = 4500;
      server = await startDelayedJsonServer(delayMs, gitea27JobsPayload);
      const api = apiForServer(server);

      const jobs = await api.listJobs(mockRepo, 964, { limit: 50, timeoutMs: JOBS_TIMEOUT_MS });

      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('build');
      expect(jobs[0].steps).toHaveLength(1);
      expect(jobs[0].steps?.[0].name).toBe('checkout');
    },
    20000
  );
});

function apiForServer(httpServer: Server): GiteaApi {
  const { port } = httpServer.address() as AddressInfo;
  return new GiteaApi(
    new GiteaClient({
      baseUrl: `http://127.0.0.1:${port}`,
      token: 'test-token'
    })
  );
}

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

function closeServer(httpServer: Server | undefined): Promise<void> {
  if (!httpServer) {
    return Promise.resolve();
  }
  httpServer.closeAllConnections();
  return new Promise((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
}
