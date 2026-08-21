import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { startMockGitea, type MockGitea } from './mockGitea';

const EXTENSION_ID = 'tarkil.gitea-actions-vscode-plugin';
const JOBS_DELAY_MS = 4500;

type TreeNode = {
  type: string;
  message?: string;
  repo?: unknown;
  run?: { id: number | string; name?: string };
  job?: { name?: string; steps?: Array<{ name: string }> };
};

type ExtensionApi = {
  setToken(token: string): Promise<void>;
  getRunsProvider(): {
    getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]>;
  };
  expandNode(node: TreeNode): Promise<void>;
};

describe('Gitea Actions Extension Host', () => {
  let mock: MockGitea | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('activates and registers the refresh command', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `Extension ${EXTENSION_ID} was not found`);
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('giteaActions.refresh'));
    assert.ok(commands.includes('giteaActions.viewJobLogs'));
  });

  it('loads jobs with official steps after a slow 1.27 jobs response', async () => {
    mock = await startMockGitea({ jobsDelayMs: JOBS_DELAY_MS });
    const api = await activateConfigured(mock.url);

    await vscode.commands.executeCommand('giteaActions.refresh');

    const repo = await waitForNode(api, undefined, (node) => node.type === 'repo');
    const run = await waitForNode(api, repo, (node) => node.type === 'run');

    const started = Date.now();
    await api.expandNode(run);
    const jobs = await waitForNode(api, run, (node) => node.type === 'job');
    const elapsed = Date.now() - started;

    assert.ok(elapsed >= JOBS_DELAY_MS, `jobs returned too quickly (${elapsed}ms); delay was not applied`);
    assert.notEqual(jobs.type, 'message', `run children were an error: ${jobs.message ?? ''}`);
    assert.equal(jobs.job?.name, 'build');
    assert.equal(jobs.job?.steps?.[0]?.name, 'checkout');
    assert.ok(
      !/aborted|timed out/i.test(jobs.message ?? ''),
      `jobs failed with timeout/abort: ${jobs.message}`
    );

    await vscode.commands.executeCommand('giteaActions.viewJobLogs', jobs);
    const logText = await waitFor(
      () =>
        vscode.workspace.textDocuments.find((doc) => doc.uri.scheme === 'gitea-actions-log')?.getText() ??
        '',
      (text) => text.includes('checked out main'),
      15000
    );
    assert.match(logText, /checked out main/);
    assert.doesNotMatch(logText, /This operation was aborted/i);
  });

  it('loads jobs and logs from the live Gitea instance', async function () {
    const liveUrl = process.env.GITEA_URL;
    const liveToken = process.env.GITEA_TOKEN;
    if (!liveUrl || !liveToken) {
      this.skip();
    }

    const api = await activateConfigured(liveUrl, liveToken);
    await vscode.commands.executeCommand('giteaActions.refresh');
    await delay(2000);
    await vscode.commands.executeCommand('giteaActions.refresh');

    const wanted = process.env.GITEA_REPO?.toLowerCase();
    const repo = await waitForNode(
      api,
      undefined,
      (node) => {
        if (node.type !== 'repo') {
          return false;
        }
        if (!wanted) {
          return true;
        }
        const label = repoLabel(node.repo);
        return label.toLowerCase() === wanted || label.toLowerCase().endsWith(`/${wanted}`);
      },
      60000
    );

    const run = await waitForNode(api, repo, (node) => node.type === 'run', 30000);
    const started = Date.now();
    await api.expandNode(run);
    const jobs = await waitForNode(
      api,
      run,
      (node) => node.type === 'job' || (node.type === 'message' && !/loading/i.test(node.message ?? '')),
      20000
    );
    const elapsed = Date.now() - started;

    assert.equal(jobs.type, 'job', `expanding the run failed after ${elapsed}ms: ${jobs.message ?? inspect(jobs)}`);
    assert.ok(
      !/aborted|timed out/i.test(jobs.message ?? ''),
      `live jobs failed after ${elapsed}ms: ${jobs.message}`
    );
    assert.ok((jobs.job?.steps?.length ?? 0) > 0, `live job "${jobs.job?.name}" had no official steps`);

    await vscode.commands.executeCommand('giteaActions.viewJobLogs', jobs);
    const logText = await waitFor(
      () =>
        vscode.workspace.textDocuments.find((doc) => doc.uri.scheme === 'gitea-actions-log')?.getText() ??
        '',
      (text) => text.length > 0 && !text.startsWith('Loading logs'),
      20000
    );
    assert.doesNotMatch(logText, /This operation was aborted/i);
    assert.doesNotMatch(logText, /Failed to load logs/i);
    assert.ok(logText.trim().length > 0, 'job log document was empty');
  });
});

function repoLabel(repo: unknown): string {
  if (!repo || typeof repo !== 'object') {
    return '';
  }
  const rec = repo as { owner?: string; name?: string };
  return rec.owner && rec.name ? `${rec.owner}/${rec.name}` : '';
}

async function activateConfigured(baseUrl: string, token = 'integration-test-token'): Promise<ExtensionApi> {
  const extension = vscode.extensions.getExtension<ExtensionApi>(EXTENSION_ID);
  assert.ok(extension, `Extension ${EXTENSION_ID} was not found`);
  const api = await extension.activate();
  await api.setToken(token);
  const cfg = vscode.workspace.getConfiguration('giteaActions');
  await cfg.update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);
  await cfg.update('discovery.mode', 'allAccessible', vscode.ConfigurationTarget.Global);
  await cfg.update('logging.verbose', true, vscode.ConfigurationTarget.Global);
  // Config updates schedule a refresh. Wait so the next explicit refresh is not
  // coalesced onto a request that still had the previous URL or token.
  await delay(2500);
  return api;
}

async function waitForNode(
  api: ExtensionApi,
  parent: TreeNode | undefined,
  match: (node: TreeNode) => boolean,
  timeoutMs = 20000
): Promise<TreeNode> {
  const node = await waitFor(
    async () => {
      const nodes = (await Promise.resolve(api.getRunsProvider().getChildren(parent))) ?? [];
      return nodes.find(match) ?? nodes;
    },
    (found) => !Array.isArray(found) && match(found as TreeNode),
    timeoutMs
  );
  if (Array.isArray(node) || !node) {
    throw new Error('Expected a tree node');
  }
  return node;
}

async function waitFor<T>(
  read: () => T | Promise<T>,
  match: (value: T) => boolean,
  timeoutMs: number
): Promise<T> {
  const started = Date.now();
  let last: T | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await read();
    if (match(last)) {
      return last;
    }
    await delay(150);
  }
  const snapshot = await read();
  throw new Error(`Timed out after ${timeoutMs}ms. Last value: ${inspect(last)} Snapshot: ${inspect(snapshot)}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inspect(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
