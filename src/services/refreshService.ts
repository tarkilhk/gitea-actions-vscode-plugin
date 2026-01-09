import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { GiteaClient } from '../gitea/client';
import { RepoRef, WorkflowRun, Job, Step, PinnedRepo } from '../gitea/models';
import { ExtensionSettings, getSettings } from '../config/settings';
import { getToken } from '../config/secrets';
import { discoverWorkspaceRepos, buildPinnedRepoRefs } from '../gitea/discovery';
import { ActionsTreeProvider } from '../views/actionsTreeProvider';
import { SettingsTreeProvider } from '../views/settingsTreeProvider';
import { logDebug, logWarn } from '../util/logging';
import { JOBS_TIMEOUT_MS, JOB_REFRESH_DELAY_MS, MAX_CONCURRENT_REPOS, MAX_CONCURRENT_JOBS } from '../config/constants';
import { isRunning, updateStatusBar } from './statusBarService';
import { isJobActive } from './logStreamService';

export type ConfigError = {
  message: string;
  action: 'configureBaseUrl' | 'setToken';
};

export type RefreshServiceState = {
  settings: ExtensionSettings;
  cachedToken: string | undefined;
  secretStorage: vscode.SecretStorage;
  pinnedRepos: PinnedRepo[];
  workspaceProvider: ActionsTreeProvider;
  pinnedProvider: ActionsTreeProvider;
  settingsProvider: SettingsTreeProvider;
  lastRunsByRepo: Map<string, WorkflowRun[]>;
  workflowNameCache: Map<string, Map<string, string>>;
  inFlightJobFetch: Map<string, Promise<Job[] | undefined>>;
  jobRefreshTimers: Map<string, NodeJS.Timeout>;
  jobStepsCache: Map<string, Step[]>;
};

let refreshInFlight: Promise<boolean> | undefined;

/**
 * Gets configuration errors (missing base URL or token).
 */
export async function getConfigErrors(state: RefreshServiceState): Promise<ConfigError[]> {
  const settings = getSettings();
  const hasBaseUrl = !!settings.baseUrl;
  const token = state.cachedToken ?? (await getToken(state.secretStorage));
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

/**
 * Gets a combined config error message string.
 */
export async function getConfigError(state: RefreshServiceState): Promise<string | undefined> {
  const errors = await getConfigErrors(state);
  if (errors.length === 0) {
    return undefined;
  }
  if (errors.length === 1) {
    return errors[0].message;
  }
  return errors.map(e => e.message).join(' and ');
}

/**
 * Ensures API client is available, returns undefined if not configured.
 */
export async function ensureApi(state: RefreshServiceState): Promise<GiteaApi | undefined> {
  const settings = getSettings();
  if (!settings.baseUrl) {
    updateStatusBar('Set giteaActions.baseUrl');
    return undefined;
  }
  const token = state.cachedToken ?? (await getToken(state.secretStorage));
  if (!token) {
    updateStatusBar('Set Gitea token');
    return undefined;
  }
  // Update cached token in state
  state.cachedToken = token;
  const client = new GiteaClient({
    baseUrl: settings.baseUrl,
    token: token,
    insecureSkipVerify: settings.insecureSkipVerify
  });
  return new GiteaApi(client);
}

/**
 * Main refresh function - refreshes all data.
 */
export async function refreshAll(state: RefreshServiceState): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const promise = doRefreshAll(state);
  refreshInFlight = promise;
  const result = await promise;
  refreshInFlight = undefined;
  state.workflowNameCache.clear();
  return result;
}

async function doRefreshAll(state: RefreshServiceState): Promise<boolean> {
  const refreshStarted = Date.now();
  const api = await ensureApi(state);
  if (!api) {
    const configErrors = await getConfigErrors(state);
    state.workspaceProvider.clear();
    state.pinnedProvider.clear();
    if (configErrors.length > 0) {
      state.workspaceProvider.setConfigErrors(configErrors);
      state.pinnedProvider.setConfigErrors(configErrors);
    }
    state.lastRunsByRepo.clear();
    updateStatusBar('Gitea: not configured');
    return false;
  }

  const settings = getSettings();
  const { workspaceRepos, pinnedRefs, pinnedKeys } = await resolveRepos(api, state, settings);
  state.workspaceProvider.setRepositories(workspaceRepos, pinnedKeys);
  const pinnedSource = pinnedRefs.length ? pinnedRefs : workspaceRepos;
  state.pinnedProvider.setRepositories(pinnedSource, pinnedKeys);

  const combinedRepos = mergeRepos(workspaceRepos, pinnedRefs);
  
  // Update settings view with the first available repo
  state.settingsProvider.setTokenStatus(!!state.cachedToken);
  if (combinedRepos.length > 0) {
    const settingsRepo = combinedRepos[0];
    state.settingsProvider.setRepository(settingsRepo);
  } else {
    state.settingsProvider.setRepository(undefined);
  }
  let anyRunning = false;

  await runWithLimit(combinedRepos, MAX_CONCURRENT_REPOS, async (repo) => {
    state.workspaceProvider.setRepoLoading(repo);
    state.pinnedProvider.setRepoLoading(repo);
    try {
      const runStart = Date.now();
      const workflowMap = await refreshWorkflows(api, repo, state);
      const runs = await api.listRuns(repo, settings.maxRunsPerRepo);
      const limitedRuns = runs.slice(0, settings.maxRunsPerRepo);
      limitedRuns.forEach((run) => {
        const workflowId = workflowIdFromPath(run.workflowPath);
        const name = workflowId ? workflowMap?.get(workflowId) : undefined;
        if (name) {
          run.workflowName = name;
        }
      });
      state.workspaceProvider.updateRuns(repo, limitedRuns);
      state.pinnedProvider.updateRuns(repo, limitedRuns);
      state.lastRunsByRepo.set(repoKey(repo), limitedRuns);
      logDebug(`Runs fetched for ${repo.owner}/${repo.name}: ${limitedRuns.length} in ${Date.now() - runStart}ms`);
      if (limitedRuns.some((r) => isRunning(r.status))) {
        anyRunning = true;
      }
      await runWithLimit(limitedRuns, MAX_CONCURRENT_JOBS, async (run) => {
        await fetchJobsForRun(repo, run.id, state, settings);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.workspaceProvider.setRepoError(repo, message);
      state.pinnedProvider.setRepoError(repo, message);
      logWarn(`Failed to refresh ${repo.owner}/${repo.name}: ${message}`);
    }
  });

  logDebug(`Refresh cycle completed in ${Date.now() - refreshStarted}ms`);
  updateStatusBar(undefined, state.lastRunsByRepo);
  return anyRunning;
}

async function resolveRepos(
  api: GiteaApi,
  state: RefreshServiceState,
  settings: ExtensionSettings
): Promise<{ workspaceRepos: RepoRef[]; pinnedRefs: RepoRef[]; pinnedKeys: Set<string> }> {
  const pinnedRefs = buildPinnedRepoRefs(settings.baseUrl, state.pinnedRepos);
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

async function refreshWorkflows(
  api: GiteaApi,
  repo: RepoRef,
  state: RefreshServiceState
): Promise<Map<string, string> | undefined> {
  const key = repoKey(repo);
  if (state.workflowNameCache.has(key)) {
    return state.workflowNameCache.get(key);
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
    state.workflowNameCache.set(key, map);
    return map;
  } catch (err) {
    logWarn(`Failed to fetch workflows for ${repo.owner}/${repo.name}: ${String(err)}`);
    return undefined;
  }
}

export async function fetchJobsForRun(
  repo: RepoRef,
  runId: number | string,
  state: RefreshServiceState,
  settings: ExtensionSettings,
  options?: { refreshOnly?: boolean }
): Promise<Job[] | undefined> {
  const key = `${repoKey(repo)}#${runId}`;
  if (state.inFlightJobFetch.has(key)) {
    return state.inFlightJobFetch.get(key);
  }
  const error = await getConfigError(state);
  if (error) {
    state.workspaceProvider.setRunJobsError(repo, runId, error);
    state.pinnedProvider.setRunJobsError(repo, runId, error);
    return;
  }
  const api = await ensureApi(state);
  if (!api) {
    return;
  }
  if (!options?.refreshOnly) {
    state.workspaceProvider.setRunJobsLoading(repo, runId);
    state.pinnedProvider.setRunJobsLoading(repo, runId);
  }
  const fetchPromise = (async () => {
    try {
      logDebug(`Fetching jobs for ${repo.owner}/${repo.name} run ${runId} (limit=${settings.maxJobsPerRun}, timeout=${JOBS_TIMEOUT_MS}ms)`);
      const start = Date.now();
      const jobs = await api.listJobs(repo, runId, { limit: settings.maxJobsPerRun, timeoutMs: JOBS_TIMEOUT_MS });
      const hydratedCount = await hydrateJobSteps(api, repo, runId, jobs, state);
      const elapsed = Date.now() - start;
      const hydrationNote = hydratedCount ? ` (steps fetched for ${hydratedCount} job${hydratedCount === 1 ? '' : 's'})` : '';
      logDebug(`Fetched ${jobs.length} jobs for ${repo.owner}/${repo.name} run ${runId} in ${elapsed}ms${hydrationNote}`);
      state.workspaceProvider.updateJobs(repo, runId, jobs);
      state.pinnedProvider.updateJobs(repo, runId, jobs);
      scheduleJobRefresh(repo, runId, jobs, state, settings);
      return jobs;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Failed to fetch jobs for ${repo.owner}/${repo.name} run ${runId}: ${message}`);
      state.workspaceProvider.setRunJobsError(repo, runId, message);
      state.pinnedProvider.setRunJobsError(repo, runId, message);
    } finally {
      state.inFlightJobFetch.delete(key);
    }
  })();
  state.inFlightJobFetch.set(key, fetchPromise);
  return fetchPromise;
}

export async function hydrateJobSteps(
  api: GiteaApi,
  repo: RepoRef,
  runId: number | string,
  jobs: Job[],
  state: RefreshServiceState
): Promise<number> {
  const missing = jobs.filter((job) => !job.steps || job.steps.length === 0);
  if (!missing.length) {
    return 0;
  }
  const hydrateStart = Date.now();
  await runWithLimit(missing, MAX_CONCURRENT_JOBS, async (job) => {
    const cacheKey = `${repo.owner}/${repo.name}#${job.id}`;
    const cachedSteps = state.jobStepsCache.get(cacheKey);
    if (cachedSteps?.length) {
      job.steps = cachedSteps;
      return;
    }
    try {
      const detailed = await api.getJob(repo, job.id, { timeoutMs: JOBS_TIMEOUT_MS });
      if (detailed.steps?.length) {
        job.steps = detailed.steps;
        state.jobStepsCache.set(cacheKey, detailed.steps);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDebug(`Failed to fetch steps for job ${job.id} in ${repo.owner}/${repo.name} run ${runId}: ${message}`);
    }
  });
  logDebug(`Hydrated steps for ${missing.length} job(s) in ${repo.owner}/${repo.name} run ${runId} in ${Date.now() - hydrateStart}ms`);
  return missing.length;
}

export function scheduleJobRefresh(
  repo: RepoRef,
  runId: number | string,
  jobs: Job[],
  state: RefreshServiceState,
  settings: ExtensionSettings
): void {
  const key = `${repoKey(repo)}#${runId}`;
  const hasActive = jobs.some((job) => isJobActive(job.status));
  if (!hasActive) {
    const existing = state.jobRefreshTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      state.jobRefreshTimers.delete(key);
    }
    return;
  }
  if (state.jobRefreshTimers.has(key)) {
    return;
  }
  const timer = setTimeout(() => {
    state.jobRefreshTimers.delete(key);
    void fetchJobsForRun(repo, runId, state, settings, { refreshOnly: true });
  }, JOB_REFRESH_DELAY_MS);
  state.jobRefreshTimers.set(key, timer);
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

export function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
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
