import * as vscode from 'vscode';
import { getSettings, ExtensionSettings } from './config/settings';
import { clearToken, getToken, promptForToken, storeToken } from './config/secrets';
import { GiteaClient } from './gitea/client';
import { GiteaApi } from './gitea/api';
import { RepoRef, WorkflowRun, PinnedRepo } from './gitea/models';
import { ActionsTreeProvider } from './views/actionsTreeProvider';
import { registerCommands } from './controllers/commands';
import { RefreshController } from './controllers/refreshController';
import { discoverWorkspaceRepos, loadPinned, savePinned, buildPinnedRepoRefs } from './gitea/discovery';
import { logError, logWarn } from './util/logging';
import { normalizeStatus } from './util/status';

let settings: ExtensionSettings;
let cachedToken: string | undefined;
let secretStorage: vscode.SecretStorage;
const treeProvider = new ActionsTreeProvider();
let refreshController: RefreshController | undefined;
let lastRunsByRepo = new Map<string, WorkflowRun[]>();
let statusBarItem: vscode.StatusBarItem;
let pinnedRepos: PinnedRepo[] = [];
let refreshInFlight: Promise<boolean> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  settings = getSettings();
  secretStorage = context.secrets;
  cachedToken = await getToken(secretStorage);
  pinnedRepos = await loadPinned(context.globalState);

  const treeDisposable = vscode.window.registerTreeDataProvider('giteaActions.runs', treeProvider);
  context.subscriptions.push(treeDisposable);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'workbench.view.extension.giteaActions';
  statusBarItem.text = 'Gitea: idle';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  registerCommands(context, {
    setToken: () => setTokenCommand(context),
    clearToken: () => clearTokenCommand(context),
    testConnection: () => testConnectionCommand(),
    refresh: () => manualRefresh(),
    viewJobLogs: (node) => viewJobLogs(node),
    openInBrowser: (node) => openInBrowser(node),
    pinRepo: (repo) => pinRepo(context, repo),
    unpinRepo: (repo) => unpinRepo(context, repo)
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('giteaActions')) {
        settings = getSettings();
        scheduleRefresh();
      }
    })
  );

  refreshController = new RefreshController(() => refreshAll(), () => ({
    runningSeconds: settings.runningIntervalSeconds,
    idleSeconds: settings.idleIntervalSeconds
  }));
  context.subscriptions.push(refreshController);
  refreshController.start();
}

export function deactivate(): void {
  refreshController?.dispose();
}

async function ensureApi(): Promise<GiteaApi | undefined> {
  settings = getSettings();
  if (!settings.baseUrl) {
    updateStatusBar('Set giteaActions.baseUrl');
    return undefined;
  }
  cachedToken = cachedToken ?? (await getToken(secretStorage));
  if (!cachedToken) {
    updateStatusBar('Set Gitea token');
    return undefined;
  }
  const client = new GiteaClient({
    baseUrl: settings.baseUrl,
    token: cachedToken,
    insecureSkipVerify: settings.insecureSkipVerify
  });
  return new GiteaApi(client);
}

async function refreshAll(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const promise = doRefreshAll();
  refreshInFlight = promise;
  const result = await promise;
  refreshInFlight = undefined;
  return result;
}

async function doRefreshAll(): Promise<boolean> {
  const api = await ensureApi();
  if (!api) {
    treeProvider.clear();
    lastRunsByRepo.clear();
    updateStatusBar('Gitea: not configured');
    return false;
  }

  const { repos, pinnedKeys } = await resolveRepos(api);
  treeProvider.setRepositories(repos, pinnedKeys);
  let anyRunning = false;

  await runWithLimit(repos, 4, async (repo) => {
    treeProvider.setRepoLoading(repo);
    try {
      const runs = await api.listRuns(repo, settings.maxRunsPerRepo);
      const limitedRuns = runs.slice(0, settings.maxRunsPerRepo);
      treeProvider.updateRuns(repo, limitedRuns);
      lastRunsByRepo.set(repoKey(repo), limitedRuns);
      if (limitedRuns.some((r) => isRunning(r.status))) {
        anyRunning = true;
      }
      await runWithLimit(limitedRuns, 3, async (run) => {
        const jobs = await api.listJobs(repo, run.id);
        treeProvider.updateJobs(repo, run.id, jobs);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      treeProvider.setRepoError(repo, message);
      logWarn(`Failed to refresh ${repo.owner}/${repo.name}: ${message}`);
    }
  });

  updateStatusBar();
  return anyRunning;
}

async function resolveRepos(api: GiteaApi): Promise<{ repos: RepoRef[]; pinnedKeys: Set<string> }> {
  settings = getSettings();
  const pinnedRefs = buildPinnedRepoRefs(settings.baseUrl, pinnedRepos);
  const pinnedKeys = new Set(pinnedRefs.map((r) => repoKey(r)));
  let baseHost = '';
  try {
    baseHost = new URL(settings.baseUrl).host;
  } catch {
    baseHost = '';
  }

  let discovered: RepoRef[] = [];
  const folders = vscode.workspace.workspaceFolders ?? [];

  if (settings.discoveryMode === 'workspace') {
    discovered = await discoverWorkspaceRepos(settings.baseUrl, folders);
  } else if (settings.discoveryMode === 'pinned') {
    discovered = [];
  } else if (settings.discoveryMode === 'allAccessible') {
    try {
      const repos = await api.listAccessibleRepos();
      discovered = repos.map((repo) => ({
        host: baseHost,
        owner: repo.owner,
        name: repo.name,
        htmlUrl: repo.htmlUrl
      }));
    } catch (err) {
      logWarn(`Failed to list accessible repositories: ${String(err)}`);
      discovered = await discoverWorkspaceRepos(settings.baseUrl, folders);
    }
  }

  const merged: RepoRef[] = [...discovered];
  for (const pinned of pinnedRefs) {
    if (!merged.find((r) => repoKey(r) === repoKey(pinned))) {
      merged.push(pinned);
    }
  }

  return { repos: merged, pinnedKeys };
}

async function setTokenCommand(context: vscode.ExtensionContext): Promise<void> {
  const token = await promptForToken();
  if (!token) {
    return;
  }
  await storeToken(context.secrets, token);
  cachedToken = token;
  vscode.window.showInformationMessage('Gitea token saved.');
  scheduleRefresh();
}

async function clearTokenCommand(context: vscode.ExtensionContext): Promise<void> {
  await clearToken(context.secrets);
  cachedToken = undefined;
  vscode.window.showInformationMessage('Gitea token cleared.');
  treeProvider.clear();
  updateStatusBar('Gitea: token cleared');
}

async function testConnectionCommand(): Promise<void> {
  const api = await ensureApi();
  if (!api) {
    vscode.window.showWarningMessage('Set giteaActions.baseUrl and token before testing.');
    return;
  }
  try {
    const version = await api.testConnection();
    vscode.window.showInformationMessage(`Connected to Gitea (version ${version}).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Connection failed: ${message}`);
    logError('Connection test failed', error);
  }
}

async function manualRefresh(): Promise<void> {
  await refreshAll();
}

async function viewJobLogs(node: { job: { id: number | string }; repo: RepoRef }): Promise<void> {
  const api = await ensureApi();
  if (!api) {
    vscode.window.showWarningMessage('Cannot fetch logs; configure base URL and token first.');
    return;
  }
  try {
    const content = await api.getJobLogs(node.repo, node.job.id);
    const doc = await vscode.workspace.openTextDocument({ content, language: 'log' });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to load logs: ${message}`);
  }
}

async function openInBrowser(node: any): Promise<void> {
  let url: string | undefined;
  if (node?.repo?.htmlUrl && node.type === 'repo') {
    url = node.repo.htmlUrl;
  } else if (node?.run?.htmlUrl) {
    url = node.run.htmlUrl;
  } else if (node?.job?.htmlUrl) {
    url = node.job.htmlUrl;
  }
  if (!url) {
    vscode.window.showInformationMessage('No URL available for this item.');
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

async function pinRepo(context: vscode.ExtensionContext, repo: RepoRef): Promise<void> {
  if (pinnedRepos.find((r) => r.owner === repo.owner && r.name === repo.name)) {
    return;
  }
  pinnedRepos = [...pinnedRepos, { owner: repo.owner, name: repo.name }];
  await savePinned(context.globalState, pinnedRepos);
  vscode.window.showInformationMessage(`Pinned ${repo.owner}/${repo.name}.`);
  scheduleRefresh();
}

async function unpinRepo(context: vscode.ExtensionContext, repo: RepoRef): Promise<void> {
  pinnedRepos = pinnedRepos.filter((r) => !(r.owner === repo.owner && r.name === repo.name));
  await savePinned(context.globalState, pinnedRepos);
  vscode.window.showInformationMessage(`Unpinned ${repo.owner}/${repo.name}.`);
  scheduleRefresh();
}

function scheduleRefresh(): void {
  refreshController?.stop();
  refreshController?.start();
}

function updateStatusBar(text?: string): void {
  if (!statusBarItem) {
    return;
  }
  if (text) {
    statusBarItem.text = text;
    statusBarItem.tooltip = 'Gitea Actions';
    statusBarItem.show();
    return;
  }
  let running = 0;
  let failed = 0;
  for (const runs of lastRunsByRepo.values()) {
    running += runs.filter((r) => isRunning(r.status)).length;
    failed += runs.filter((r) => r.conclusion === 'failure').length;
  }
  statusBarItem.text = `Gitea: ${running} running, ${failed} failed`;
  statusBarItem.tooltip = 'Open Gitea Actions view';
  statusBarItem.show();
}

function isRunning(status?: string): boolean {
  const normalized = normalizeStatus(status);
  return normalized === 'running' || normalized === 'queued';
}

async function runWithLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length || 1) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) {
        return;
      }
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}
