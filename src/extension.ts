import * as vscode from 'vscode';
import { getSettings, ExtensionSettings } from './config/settings';
import { clearToken, getToken, promptForToken, storeToken } from './config/secrets';
import { GiteaClient } from './gitea/client';
import { GiteaApi } from './gitea/api';
import { RepoRef, WorkflowRun, PinnedRepo, Job, Step } from './gitea/models';
import { ActionsTreeProvider } from './views/actionsTreeProvider';
import { SettingsTreeProvider } from './views/settingsTreeProvider';
import { ActionsNode, SecretsRootNode, SecretNode, VariablesRootNode, VariableNode } from './views/nodes';
import { registerCommands } from './controllers/commands';
import { RefreshController } from './controllers/refreshController';
import { discoverWorkspaceRepos, loadPinned, savePinned, buildPinnedRepoRefs } from './gitea/discovery';
import { logError, logWarn, logDebug, setVerboseLogging } from './util/logging';
import { normalizeStatus } from './util/status';

let settings: ExtensionSettings;
let cachedToken: string | undefined;
let secretStorage: vscode.SecretStorage;
const workspaceProvider = new ActionsTreeProvider('runs');
const pinnedProvider = new ActionsTreeProvider('workflows');
const settingsProvider = new SettingsTreeProvider();
let workspaceTree: vscode.TreeView<ActionsNode>;
let pinnedTree: vscode.TreeView<ActionsNode>;
let settingsTree: vscode.TreeView<ActionsNode>;
let refreshController: RefreshController | undefined;
const lastRunsByRepo = new Map<string, WorkflowRun[]>();
const workflowNameCache = new Map<string, Map<string, string>>();
let statusBarItem: vscode.StatusBarItem;
let pinnedRepos: PinnedRepo[] = [];
let refreshInFlight: Promise<boolean> | undefined;
const inFlightJobFetch = new Map<string, Promise<Job[] | undefined>>();
const jobRefreshTimers = new Map<string, NodeJS.Timeout>();
const jobStepsCache = new Map<string, Step[]>();
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

/**
 * Shows a toast notification that auto-dismisses after a few seconds.
 * Uses VS Code's progress notification for info messages (auto-dismisses).
 * Warnings and errors use standard message dialogs that require dismissal.
 */
function showToast(message: string, type: 'info' | 'warning' | 'error' = 'info', timeoutMs: number = 4000): void {
  if (type === 'warning') {
    void vscode.window.showWarningMessage(message);
  } else if (type === 'error') {
    void vscode.window.showErrorMessage(message);
  } else {
    // Use progress notification for info messages - auto-dismisses after timeout
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: message,
        cancellable: false
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      }
    );
  }
}

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
  settingsTree = vscode.window.createTreeView('giteaActions.settings', {
    treeDataProvider: settingsProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(workspaceTree, pinnedTree, settingsTree);
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
    unpinRepo: (repo) => unpinRepo(context, repo),
    refreshSecrets: (node) => refreshSecrets(node),
    refreshVariables: (node) => refreshVariables(node),
    createSecret: (node) => createSecret(node),
    updateSecret: (node) => updateSecret(node),
    deleteSecret: (node) => deleteSecret(node),
    createVariable: (node) => createVariable(node),
    updateVariable: (node) => updateVariable(node),
    deleteVariable: (node) => deleteVariable(node),
    openBaseUrlSettings: () => openBaseUrlSettings()
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

  // Refresh when views become visible to ensure fresh data
  context.subscriptions.push(
    workspaceTree.onDidChangeVisibility((e) => {
      if (e.visible) {
        void refreshAll();
      }
    }),
    settingsTree.onDidChangeVisibility((e) => {
      if (e.visible) {
        void refreshAll();
      }
    })
  );
  
  // Initialize token status (refreshAll will be triggered by refresh controller immediately)
  settingsProvider.setTokenStatus(!!cachedToken);
}

export function deactivate(): void {
  refreshController?.dispose();
}

export type ConfigError = {
  message: string;
  action: 'configureBaseUrl' | 'setToken';
};

async function getConfigErrors(): Promise<ConfigError[]> {
  settings = getSettings();
  const hasBaseUrl = !!settings.baseUrl;
  const token = cachedToken ?? (await getToken(secretStorage));
  const hasToken = !!token;
  
  const errors: ConfigError[] = [];
  if (!hasBaseUrl) {
    errors.push({ message: 'Configure base URL', action: 'configureBaseUrl' });
  }
  if (!hasToken) {
    errors.push({ message: 'Configure token', action: 'setToken' });
  }
  return errors;
}

// Helper function for backward compatibility - returns combined message string
async function getConfigError(): Promise<string | undefined> {
  const errors = await getConfigErrors();
  if (errors.length === 0) {
    return undefined;
  }
  if (errors.length === 1) {
    return errors[0].message;
  }
  // Combine multiple errors into a single message for status bar/warnings
  return errors.map(e => e.message).join(' and ');
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
  workflowNameCache.clear();
  return result;
}

async function doRefreshAll(): Promise<boolean> {
  const refreshStarted = Date.now();
  const api = await ensureApi();
  if (!api) {
    const configErrors = await getConfigErrors();
    workspaceProvider.clear();
    pinnedProvider.clear();
    if (configErrors.length > 0) {
      workspaceProvider.setConfigErrors(configErrors);
      pinnedProvider.setConfigErrors(configErrors);
    }
    lastRunsByRepo.clear();
    updateStatusBar('Gitea: not configured');
    return false;
  }

  const { workspaceRepos, pinnedRefs, pinnedKeys } = await resolveRepos(api);
  workspaceProvider.setRepositories(workspaceRepos, pinnedKeys);
  const pinnedSource = pinnedRefs.length ? pinnedRefs : workspaceRepos;
  pinnedProvider.setRepositories(pinnedSource, pinnedKeys);

  const combinedRepos = mergeRepos(workspaceRepos, pinnedRefs);
  
  // Update settings view with the first available repo
  settingsProvider.setTokenStatus(!!cachedToken);
  if (combinedRepos.length > 0) {
    const settingsRepo = combinedRepos[0];
    settingsProvider.setRepository(settingsRepo);
    void refreshSecretsForRepo(settingsRepo);
    void refreshVariablesForRepo(settingsRepo);
  } else {
    settingsProvider.setRepository(undefined);
  }
  let anyRunning = false;

  await runWithLimit(combinedRepos, 4, async (repo) => {
    workspaceProvider.setRepoLoading(repo);
    pinnedProvider.setRepoLoading(repo);
    try {
      const runStart = Date.now();
      const workflowMap = await refreshWorkflows(api, repo);
      const runs = await api.listRuns(repo, settings.maxRunsPerRepo);
      const limitedRuns = runs.slice(0, settings.maxRunsPerRepo);
      limitedRuns.forEach((run) => {
        const workflowId = workflowIdFromPath(run.workflowPath);
        const name = workflowId ? workflowMap?.get(workflowId) : undefined;
        if (name) {
          run.workflowName = name;
        }
      });
      workspaceProvider.updateRuns(repo, limitedRuns);
      pinnedProvider.updateRuns(repo, limitedRuns);
      lastRunsByRepo.set(repoKey(repo), limitedRuns);
      logDebug(`Runs fetched for ${repo.owner}/${repo.name}: ${limitedRuns.length} in ${Date.now() - runStart}ms`);
      if (limitedRuns.some((r) => isRunning(r.status))) {
        anyRunning = true;
      }
      await runWithLimit(limitedRuns, 3, async (run) => {
        await fetchJobsForRun(repo, run.id);
      });
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

async function openBaseUrlSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', '@giteaActions');
}

async function setTokenCommand(context: vscode.ExtensionContext): Promise<void> {
  const token = await promptForToken();
  if (!token) {
    return;
  }
  await storeToken(context.secrets, token);
  cachedToken = token;
  settingsProvider.setTokenStatus(true);
  showToast('Gitea token saved.');
  scheduleRefresh();
}

async function clearTokenCommand(context: vscode.ExtensionContext): Promise<void> {
  const hadToken = !!cachedToken;
  await clearToken(context.secrets);
  cachedToken = undefined;
  settingsProvider.setTokenStatus(false);
  workspaceProvider.clear();
  pinnedProvider.clear();
  
  // Set the config errors so the tree views show "Configure token" instead of "No repositories found"
  const configErrors = await getConfigErrors();
  if (configErrors.length > 0) {
    workspaceProvider.setConfigErrors(configErrors);
    pinnedProvider.setConfigErrors(configErrors);
  }
  
  // Only show message and update status bar if we actually cleared a token
  if (hadToken) {
    updateStatusBar('Gitea: token cleared');
    showToast('Gitea token cleared.');
  } else {
    // If there was no token, just update to the proper state immediately
    const error = await getConfigError();
    if (error) {
      updateStatusBar('Gitea: not configured');
    } else {
      updateStatusBar();
    }
  }
}

async function testConnectionCommand(): Promise<void> {
  const error = await getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before testing.`);
    return;
  }
  const api = await ensureApi();
  if (!api) {
    return;
  }
  try {
    const version = await api.testConnection();
    showToast(`Connected to Gitea (version ${version}).`);
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
  const error = await getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`Cannot fetch logs; ${error.toLowerCase()} first.`);
    return;
  }
  const api = await ensureApi();
  if (!api) {
    return;
  }
  const runId = node.runId ?? (node as { run?: { id?: number | string } }).run?.id;
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

async function openInBrowser(node: ActionsNode): Promise<void> {
  let url: string | undefined;
  if (node.type === 'run') {
    url = node.run.htmlUrl;
  } else if (node.type === 'job' || node.type === 'step') {
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
  showToast(`Pinned ${repo.owner}/${repo.name}.`);
  scheduleRefresh();
}

async function unpinRepo(context: vscode.ExtensionContext, repo: RepoRef): Promise<void> {
  pinnedRepos = pinnedRepos.filter((r) => !(r.owner === repo.owner && r.name === repo.name));
  await savePinned(context.globalState, pinnedRepos);
  showToast(`Unpinned ${repo.owner}/${repo.name}.`);
  scheduleRefresh();
}

async function handleExpand(element: ActionsNode): Promise<void> {
  if (!element) {
    return;
  }
  if (element.type === 'run') {
    await fetchJobsForRun(element.repo, element.run.id);
  }
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
  const error = await getConfigError();
  if (error) {
    workspaceProvider.setRunJobsError(repo, runId, error);
    pinnedProvider.setRunJobsError(repo, runId, error);
    return;
  }
  const api = await ensureApi();
  if (!api) {
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
      const hydratedCount = await hydrateJobSteps(api, repo, runId, jobs);
      const elapsed = Date.now() - start;
      const hydrationNote = hydratedCount ? ` (steps fetched for ${hydratedCount} job${hydratedCount === 1 ? '' : 's'})` : '';
      logDebug(`Fetched ${jobs.length} jobs for ${repo.owner}/${repo.name} run ${runId} in ${elapsed}ms${hydrationNote}`);
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

async function hydrateJobSteps(api: GiteaApi, repo: RepoRef, runId: number | string, jobs: Job[]): Promise<number> {
  const missing = jobs.filter((job) => !job.steps || job.steps.length === 0);
  if (!missing.length) {
    return 0;
  }
  const hydrateStart = Date.now();
  await runWithLimit(missing, 3, async (job) => {
    const cacheKey = `${repo.owner}/${repo.name}#${job.id}`;
    const cachedSteps = jobStepsCache.get(cacheKey);
    if (cachedSteps?.length) {
      job.steps = cachedSteps;
      return;
    }
    try {
      const detailed = await api.getJob(repo, job.id, { timeoutMs: JOBS_TIMEOUT_MS });
      if (detailed.steps?.length) {
        job.steps = detailed.steps;
        jobStepsCache.set(cacheKey, detailed.steps);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDebug(`Failed to fetch steps for job ${job.id} in ${repo.owner}/${repo.name} run ${runId}: ${message}`);
    }
  });
  logDebug(`Hydrated steps for ${missing.length} job(s) in ${repo.owner}/${repo.name} run ${runId} in ${Date.now() - hydrateStart}ms`);
  return missing.length;
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
        await hydrateJobSteps(api, repo, runId, jobs);
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

async function refreshWorkflows(api: GiteaApi, repo: RepoRef): Promise<Map<string, string> | undefined> {
  const key = repoKey(repo);
  if (workflowNameCache.has(key)) {
    return workflowNameCache.get(key);
  }
  try {
    const workflows = await api.listWorkflows(repo);
    const map = new Map<string, string>();
    workflows.forEach((wf) => {
      const id = workflowIdFromPath(wf.id ?? wf.path);
      if (id && wf.name) {
        map.set(id, wf.name);
      }
    });
    workflowNameCache.set(key, map);
    return map;
  } catch (err) {
    logWarn(`Failed to fetch workflows for ${repo.owner}/${repo.name}: ${String(err)}`);
    return undefined;
  }
}

function workflowIdFromPath(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }
  const beforeAt = path.split('@')[0] ?? path;
  const parts = beforeAt.split('/');
  const file = parts[parts.length - 1];
  return file || undefined;
}

async function refreshSecretsForRepo(repo: RepoRef): Promise<void> {
  const error = await getConfigError();
  if (error) {
    settingsProvider.setSecretsError(error);
    return;
  }
  const api = await ensureApi();
  if (!api) {
    return;
  }
  
  settingsProvider.setSecretsLoading();
  try {
    const secrets = await api.listSecrets(repo);
    settingsProvider.setSecrets(secrets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    settingsProvider.setSecretsError(message);
    logWarn(`Failed to refresh secrets for ${repo.owner}/${repo.name}: ${message}`);
  }
}

async function refreshVariablesForRepo(repo: RepoRef): Promise<void> {
  const error = await getConfigError();
  if (error) {
    settingsProvider.setVariablesError(error);
    return;
  }
  const api = await ensureApi();
  if (!api) {
    return;
  }
  
  settingsProvider.setVariablesLoading();
  try {
    const variables = await api.listVariables(repo);
    settingsProvider.setVariables(variables);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    settingsProvider.setVariablesError(message);
    logWarn(`Failed to refresh variables for ${repo.owner}/${repo.name}: ${message}`);
  }
}

async function refreshSecrets(node: SecretsRootNode): Promise<void> {
  await refreshSecretsForRepo(node.repo);
}

async function refreshVariables(node: VariablesRootNode): Promise<void> {
  await refreshVariablesForRepo(node.repo);
}

async function createSecret(node: SecretsRootNode): Promise<void> {
  const error = await getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before creating secrets.`);
    return;
  }
  const api = await ensureApi();
  if (!api) {
    return;
  }
  
  const name = await vscode.window.showInputBox({
    prompt: 'Secret name',
    placeHolder: 'SECRET_NAME',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Secret name cannot be empty';
      }
      if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) {
        return 'Secret name should be uppercase letters, numbers, and underscores only';
      }
      return undefined;
    }
  });
  
  if (!name) {
    return;
  }
  
  const data = await vscode.window.showInputBox({
    prompt: 'Secret value',
    placeHolder: 'Enter secret value',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (!value.trim() ? 'Secret value cannot be empty' : undefined)
  });
  
  if (!data) {
    return;
  }
  
  const description = await vscode.window.showInputBox({
    prompt: 'Description (optional)',
    placeHolder: 'Optional description'
  });
  
  try {
    await api.createOrUpdateSecret(node.repo, name.trim(), data.trim(), description?.trim());
    showToast(`Secret ${name} created successfully.`);
    await refreshSecretsForRepo(node.repo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create secret: ${message}`);
    logError('Failed to create secret', error);
  }
}

async function updateSecret(node: SecretNode): Promise<void> {
  const error = await getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before updating secrets.`);
    return;
  }
  const api = await ensureApi();
  if (!api) {
    return;
  }
  
  const data = await vscode.window.showInputBox({
    prompt: 'New secret value',
    placeHolder: 'Enter new secret value',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (!value.trim() ? 'Secret value cannot be empty' : undefined)
  });
  
  if (!data) {
    return;
  }
  
  const description = await vscode.window.showInputBox({
    prompt: 'Description (optional)',
    placeHolder: node.description || 'Optional description',
    value: node.description
  });
  
  try {
    await api.createOrUpdateSecret(node.repo, node.name, data.trim(), description?.trim());
    showToast(`Secret ${node.name} updated successfully.`);
    await refreshSecretsForRepo(node.repo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to update secret: ${message}`);
    logError('Failed to update secret', error);
  }
}

async function deleteSecret(node: SecretNode): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `Delete secret "${node.name}"? This action cannot be undone.`,
    { modal: true },
    'Delete'
  );
  
  if (confirmed !== 'Delete') {
    return;
  }
  
  const error = await getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before deleting secrets.`);
    return;
  }
  const api = await ensureApi();
  if (!api) {
    return;
  }
  
  try {
    await api.deleteSecret(node.repo, node.name);
    showToast(`Secret ${node.name} deleted successfully.`);
    await refreshSecretsForRepo(node.repo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to delete secret: ${message}`);
    logError('Failed to delete secret', error);
  }
}

async function createVariable(node: VariablesRootNode): Promise<void> {
  const error = await getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before creating variables.`);
    return;
  }
  const api = await ensureApi();
  if (!api) {
    return;
  }
  
  const name = await vscode.window.showInputBox({
    prompt: 'Variable name',
    placeHolder: 'VARIABLE_NAME',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Variable name cannot be empty';
      }
      return undefined;
    }
  });
  
  if (!name) {
    return;
  }
  
  const value = await vscode.window.showInputBox({
    prompt: 'Variable value',
    placeHolder: 'Enter variable value',
    ignoreFocusOut: true,
    validateInput: (value) => (!value.trim() ? 'Variable value cannot be empty' : undefined)
  });
  
  if (!value) {
    return;
  }
  
  const description = await vscode.window.showInputBox({
    prompt: 'Description (optional)',
    placeHolder: 'Optional description'
  });
  
  try {
    await api.createVariable(node.repo, name.trim(), value.trim(), description?.trim());
    showToast(`Variable ${name} created successfully.`);
    await refreshVariablesForRepo(node.repo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create variable: ${message}`);
    logError('Failed to create variable', error);
  }
}

async function updateVariable(node: VariableNode): Promise<void> {
  const error = await getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before updating variables.`);
    return;
  }
  const api = await ensureApi();
  if (!api) {
    return;
  }
  
  // Get current value from API
  let currentValue = node.value;
  if (!currentValue) {
    try {
      const variable = await api.getVariable(node.repo, node.name);
      currentValue = variable.data;
    } catch (error) {
      logWarn(`Failed to fetch current variable value: ${String(error)}`);
    }
  }
  
  const value = await vscode.window.showInputBox({
    prompt: 'New variable value',
    placeHolder: 'Enter new variable value',
    value: currentValue,
    ignoreFocusOut: true,
    validateInput: (value) => (!value.trim() ? 'Variable value cannot be empty' : undefined)
  });
  
  if (!value) {
    return;
  }
  
  const description = await vscode.window.showInputBox({
    prompt: 'Description (optional)',
    placeHolder: node.description || 'Optional description',
    value: node.description
  });
  
  try {
    await api.updateVariable(node.repo, node.name, value.trim(), description?.trim());
    showToast(`Variable ${node.name} updated successfully.`);
    await refreshVariablesForRepo(node.repo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to update variable: ${message}`);
    logError('Failed to update variable', error);
  }
}

async function deleteVariable(node: VariableNode): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `Delete variable "${node.name}"? This action cannot be undone.`,
    { modal: true },
    'Delete'
  );
  
  if (confirmed !== 'Delete') {
    return;
  }
  
  const error = await getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before deleting variables.`);
    return;
  }
  const api = await ensureApi();
  if (!api) {
    return;
  }
  
  try {
    await api.deleteVariable(node.repo, node.name);
    showToast(`Variable ${node.name} deleted successfully.`);
    await refreshVariablesForRepo(node.repo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to delete variable: ${message}`);
    logError('Failed to delete variable', error);
  }
}
