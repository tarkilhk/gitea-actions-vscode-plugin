import * as vscode from 'vscode';
import { getSettings, ExtensionSettings } from './config/settings';
import { clearToken, getToken, promptForToken, storeToken } from './config/secrets';
import { GiteaClient } from './gitea/client';
import { GiteaApi } from './gitea/api';
import { RepoRef, WorkflowRun, PinnedRepo, Job, Step } from './gitea/models';
import { ActionsTreeProvider } from './views/actionsTreeProvider';
import { registerCommands } from './controllers/commands';
import { RefreshController } from './controllers/refreshController';
import { discoverWorkspaceRepos, loadPinned, savePinned, buildPinnedRepoRefs } from './gitea/discovery';
import { logError, logWarn, logDebug, setVerboseLogging } from './util/logging';
import { normalizeStatus } from './util/status';

let settings: ExtensionSettings;
let cachedToken: string | undefined;
let secretStorage: vscode.SecretStorage;
const workspaceProvider = new ActionsTreeProvider();
const pinnedProvider = new ActionsTreeProvider();
let workspaceTree: vscode.TreeView<any>;
let pinnedTree: vscode.TreeView<any>;
let refreshController: RefreshController | undefined;
let lastRunsByRepo = new Map<string, WorkflowRun[]>();
let statusBarItem: vscode.StatusBarItem;
let pinnedRepos: PinnedRepo[] = [];
let refreshInFlight: Promise<boolean> | undefined;
const inFlightJobFetch = new Map<string, Promise<Job[] | undefined>>();
const jobRefreshTimers = new Map<string, NodeJS.Timeout>();
const JOBS_TIMEOUT_MS = 4000;

class LiveLogContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? 'Loading logs...';
  }

  update(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }

  clear(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }
}

const logContentProvider = new LiveLogContentProvider();
const liveLogStreams = new Map<string, { stopped: boolean }>();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  setVerboseLogging(true);
  settings = getSettings();
  secretStorage = context.secrets;
  cachedToken = await getToken(secretStorage);
  pinnedRepos = await loadPinned(context.globalState);

  workspaceTree = vscode.window.createTreeView('giteaActions.runs', {
    treeDataProvider: workspaceProvider,
    showCollapseAll: true
  });
  pinnedTree = vscode.window.createTreeView('giteaActions.runsPinned', {
    treeDataProvider: pinnedProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(workspaceTree, pinnedTree);
  context.subscriptions.push(
    workspaceTree.onDidExpandElement((e) => handleExpand(e.element)),
    pinnedTree.onDidExpandElement((e) => handleExpand(e.element))
  );

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'workbench.view.extension.giteaActions';
  statusBarItem.text = 'Gitea: idle';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('gitea-actions-log', logContentProvider),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === 'gitea-actions-log') {
        stopLogStream(doc.uri);
      }
    })
  );

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
  const refreshStarted = Date.now();
  const api = await ensureApi();
  if (!api) {
    workspaceProvider.clear();
    pinnedProvider.clear();
    lastRunsByRepo.clear();
    updateStatusBar('Gitea: not configured');
    return false;
  }

  const { workspaceRepos, pinnedRefs, pinnedKeys } = await resolveRepos(api);
  workspaceProvider.setRepositories(workspaceRepos, pinnedKeys);
  pinnedProvider.setRepositories(pinnedRefs, pinnedKeys);

  const combinedRepos = mergeRepos(workspaceRepos, pinnedRefs);
  let anyRunning = false;

  await runWithLimit(combinedRepos, 4, async (repo) => {
    workspaceProvider.setRepoLoading(repo);
    pinnedProvider.setRepoLoading(repo);
    try {
      const runStart = Date.now();
      const runs = await api.listRuns(repo, settings.maxRunsPerRepo);
      const limitedRuns = runs.slice(0, settings.maxRunsPerRepo);
      workspaceProvider.updateRuns(repo, limitedRuns);
      pinnedProvider.updateRuns(repo, limitedRuns);
      lastRunsByRepo.set(repoKey(repo), limitedRuns);
      logDebug(`Runs fetched for ${repo.owner}/${repo.name}: ${limitedRuns.length} in ${Date.now() - runStart}ms`);
      if (limitedRuns.some((r) => isRunning(r.status))) {
        anyRunning = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      workspaceProvider.setRepoError(repo, message);
      pinnedProvider.setRepoError(repo, message);
      logWarn(`Failed to refresh ${repo.owner}/${repo.name}: ${message}`);
    }
  });

  logDebug(`Refresh cycle completed in ${Date.now() - refreshStarted}ms`);
  updateStatusBar();
  return anyRunning;
}

async function resolveRepos(api: GiteaApi): Promise<{ workspaceRepos: RepoRef[]; pinnedRefs: RepoRef[]; pinnedKeys: Set<string> }> {
  settings = getSettings();
  const pinnedRefs = buildPinnedRepoRefs(settings.baseUrl, pinnedRepos);
  const pinnedKeys = new Set(pinnedRefs.map((r) => repoKey(r)));
  let baseHost = '';
  try {
    baseHost = new URL(settings.baseUrl).host;
  } catch {
    baseHost = '';
  }

  let workspaceRepos: RepoRef[] = [];
  const folders = vscode.workspace.workspaceFolders ?? [];

  if (settings.discoveryMode === 'workspace') {
    workspaceRepos = await discoverWorkspaceRepos(settings.baseUrl, folders);
  } else if (settings.discoveryMode === 'pinned') {
    workspaceRepos = [];
  } else if (settings.discoveryMode === 'allAccessible') {
    try {
      const repos = await api.listAccessibleRepos();
      workspaceRepos = repos.map((repo) => ({
        host: baseHost,
        owner: repo.owner,
        name: repo.name,
        htmlUrl: repo.htmlUrl
      }));
    } catch (err) {
      logWarn(`Failed to list accessible repositories: ${String(err)}`);
      workspaceRepos = await discoverWorkspaceRepos(settings.baseUrl, folders);
    }
  }

  return { workspaceRepos, pinnedRefs, pinnedKeys };
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
  workspaceProvider.clear();
  pinnedProvider.clear();
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

async function viewJobLogs(node: { job: Job; repo: RepoRef; runId?: number | string; step?: Step }): Promise<void> {
  const api = await ensureApi();
  if (!api) {
    vscode.window.showWarningMessage('Cannot fetch logs; configure base URL and token first.');
    return;
  }
  const runId = node.runId ?? (node as any)?.run?.id;
  const jobId = node.job.id;
  const shouldStream = isJobActive(node.job.status);
  const uri = buildLogUri(node.repo, runId ?? 'run', jobId, node.step?.name ?? node.step?.id);
  logContentProvider.update(uri, 'Loading logs...');

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.languages.setTextDocumentLanguage(doc, 'log');

  if (shouldStream) {
    startLogStream(api, uri, node.repo, runId, jobId).catch((err) =>
      vscode.window.showErrorMessage(`Live log stream stopped: ${err instanceof Error ? err.message : String(err)}`)
    );
  } else {
    try {
      const content = await api.getJobLogs(node.repo, jobId);
      logContentProvider.update(uri, content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logContentProvider.update(uri, `Failed to load logs: ${message}`);
      vscode.window.showErrorMessage(`Failed to load logs: ${message}`);
    }
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

async function handleExpand(element: any): Promise<void> {
  if (!element || element.type !== 'run') {
    return;
  }
  await fetchJobsForRun(element.repo, element.run.id);
}

async function fetchJobsForRun(
  repo: RepoRef,
  runId: number | string,
  options?: { refreshOnly?: boolean }
): Promise<Job[] | undefined> {
  const key = `${repoKey(repo)}#${runId}`;
  if (inFlightJobFetch.has(key)) {
    return inFlightJobFetch.get(key);
  }
  const api = await ensureApi();
  if (!api) {
    workspaceProvider.setRunJobsError(repo, runId, 'Configure baseUrl and token');
    pinnedProvider.setRunJobsError(repo, runId, 'Configure baseUrl and token');
    return;
  }
  if (!options?.refreshOnly) {
    workspaceProvider.setRunJobsLoading(repo, runId);
    pinnedProvider.setRunJobsLoading(repo, runId);
  }
  const fetchPromise = (async () => {
    try {
      logDebug(`Fetching jobs for ${repo.owner}/${repo.name} run ${runId} (limit=${settings.maxJobsPerRun}, timeout=${JOBS_TIMEOUT_MS}ms)`);
      const start = Date.now();
      const jobs = await api.listJobs(repo, runId, { limit: settings.maxJobsPerRun, timeoutMs: JOBS_TIMEOUT_MS });
      const elapsed = Date.now() - start;
      logDebug(`Fetched ${jobs.length} jobs for ${repo.owner}/${repo.name} run ${runId} in ${elapsed}ms`);
      workspaceProvider.updateJobs(repo, runId, jobs);
      pinnedProvider.updateJobs(repo, runId, jobs);
      scheduleJobRefresh(repo, runId, jobs);
      return jobs;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Failed to fetch jobs for ${repo.owner}/${repo.name} run ${runId}: ${message}`);
      workspaceProvider.setRunJobsError(repo, runId, message);
      pinnedProvider.setRunJobsError(repo, runId, message);
    } finally {
      inFlightJobFetch.delete(key);
    }
  })();
  inFlightJobFetch.set(key, fetchPromise);
  return fetchPromise;
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

function isJobActive(status?: string): boolean {
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

function scheduleJobRefresh(repo: RepoRef, runId: number | string, jobs: Job[]): void {
  const key = `${repoKey(repo)}#${runId}`;
  const hasActive = jobs.some((job) => isJobActive(job.status));
  if (!hasActive) {
    const existing = jobRefreshTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      jobRefreshTimers.delete(key);
    }
    return;
  }
  if (jobRefreshTimers.has(key)) {
    return;
  }
  const timer = setTimeout(() => {
    jobRefreshTimers.delete(key);
    void fetchJobsForRun(repo, runId, { refreshOnly: true });
  }, 3000);
  jobRefreshTimers.set(key, timer);
}

function buildLogUri(repo: RepoRef, runId: number | string, jobId: number | string, stepId?: number | string): vscode.Uri {
  const owner = encodeURIComponent(repo.owner);
  const name = encodeURIComponent(repo.name);
  const stepPart = stepId ? `/step-${encodeURIComponent(String(stepId))}` : '';
  return vscode.Uri.parse(`gitea-actions-log://${owner}/${name}/run-${runId}/job-${jobId}${stepPart}`);
}

function stopLogStream(uri: vscode.Uri): void {
  const key = uri.toString();
  const stream = liveLogStreams.get(key);
  if (stream) {
    stream.stopped = true;
    liveLogStreams.delete(key);
  }
}

async function startLogStream(
  api: GiteaApi,
  uri: vscode.Uri,
  repo: RepoRef,
  runId: number | string | undefined,
  jobId: number | string
): Promise<void> {
  stopLogStream(uri);
  const controller = { stopped: false };
  liveLogStreams.set(uri.toString(), controller);

  let lastContent = '';
  while (!controller.stopped) {
    try {
      const content = await api.getJobLogs(repo, jobId);
      if (content !== lastContent) {
        lastContent = content;
        logContentProvider.update(uri, content);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logContentProvider.update(uri, `Failed to load logs: ${message}`);
    }

    let active = true;
    if (runId !== undefined) {
      try {
        const jobs = await api.listJobs(repo, runId, { limit: settings.maxJobsPerRun, timeoutMs: JOBS_TIMEOUT_MS });
        workspaceProvider.updateJobs(repo, runId, jobs);
        pinnedProvider.updateJobs(repo, runId, jobs);
        scheduleJobRefresh(repo, runId, jobs);
        const job = jobs.find((j) => String(j.id) === String(jobId));
        active = job ? isJobActive(job.status) : false;
      } catch {
        active = true;
      }
    } else {
      active = false;
    }

    if (!active) {
      break;
    }
    await sleep(2000);
  }

  stopLogStream(uri);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeRepos(a: RepoRef[], b: RepoRef[]): RepoRef[] {
  const result: RepoRef[] = [];
  const seen = new Set<string>();
  for (const repo of [...a, ...b]) {
    const key = repoKey(repo);
    if (!seen.has(key)) {
      result.push(repo);
      seen.add(key);
    }
  }
  return result;
}
