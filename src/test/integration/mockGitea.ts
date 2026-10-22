import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockWorkflowRun = {
  id: number;
  status: string;
  conclusion?: string;
};

const DEFAULT_RUN: MockWorkflowRun = {
  id: 964,
  status: 'completed',
  conclusion: 'success'
};

function toApiRun(run: MockWorkflowRun) {
  return {
    id: run.id,
    name: 'CI',
    path: '.gitea/workflows/ci.yml',
    display_title: 'CI',
    status: run.status,
    conclusion: run.conclusion,
    event: 'push',
    head_branch: 'main',
    html_url: `http://127.0.0.1/acme/demo/actions/runs/${run.id}`
  };
}

const JOBS = {
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

const JOB_LOG = [
  '2026-08-21T00:00:00.000Z ##[group]checkout',
  '2026-08-21T00:00:01.000Z checked out main',
  '2026-08-21T00:00:02.000Z ##[endgroup]'
].join('\n');

export type MockGitea = {
  url: string;
  close: () => Promise<void>;
  setRuns: (runs: MockWorkflowRun[]) => void;
};

export function startMockGitea(options: { jobsDelayMs: number; runs?: MockWorkflowRun[] }): Promise<MockGitea> {
  let runs = options.runs ?? [DEFAULT_RUN];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    route(pathname, options.jobsDelayMs, res, () => runs);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => closeServer(server),
        setRuns: (next) => {
          runs = next;
        }
      });
    });
  });
}

function route(
  pathname: string,
  jobsDelayMs: number,
  res: ServerResponse,
  getRuns: () => MockWorkflowRun[]
): void {
  if (pathname === '/api/v1/version') {
    sendJson(res, { version: '1.27.2' });
    return;
  }
  if (pathname === '/api/v1/repos/search') {
    sendJson(res, {
      ok: true,
      data: [{ full_name: 'acme/demo', name: 'demo', owner: { login: 'acme' } }]
    });
    return;
  }
  if (pathname.endsWith('/actions/workflows')) {
    sendJson(res, {
      workflows: [{ id: 'ci.yml', name: 'CI', path: '.gitea/workflows/ci.yml' }]
    });
    return;
  }
  if (/\/actions\/runs\/\d+\/jobs$/.test(pathname)) {
    setTimeout(() => sendJson(res, JOBS), jobsDelayMs);
    return;
  }
  if (pathname.endsWith('/actions/runs') || /\/actions\/workflows\/[^/]+\/runs$/.test(pathname)) {
    sendJson(res, { workflow_runs: getRuns().map(toApiRun) });
    return;
  }
  if (pathname.endsWith('/logs')) {
    sendText(res, JOB_LOG);
    return;
  }
  if (pathname.endsWith('/actions/secrets') || pathname.endsWith('/actions/variables')) {
    sendJson(res, []);
    return;
  }
  sendJson(res, { message: `not found: ${pathname}` }, 404);
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { 'content-type': 'text/plain' });
  res.end(body);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
