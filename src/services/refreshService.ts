import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { GiteaClient } from '../gitea/client';
import { GiteaInternalApi } from '../gitea/internalApi';
import { RepoRef, RunRef, WorkflowRun, Job, Step, toRunRef } from '../gitea/models';
import { ExtensionSettings, getSettings } from '../config/settings';
import { getToken } from '../config/secrets';
import { discoverWorkspaceRepos } from '../gitea/discovery';
import { ActionsTreeProvider } from '../views/actionsTreeProvider';
import { SettingsTreeProvider } from '../views/settingsTreeProvider';
import { RunNode } from '../views/nodes';
import { logDebug, logWarn } from '../util/logging';
import { JOBS_TIMEOUT_MS, MAX_CONCURRENT_REPOS, MAX_CONCURRENT_JOBS } from '../config/constants';
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
  workspaceProvider: ActionsTreeProvider;
  pinnedProvider: ActionsTreeProvider;
  settingsProvider: SettingsTreeProvider;
  lastRunsByRepo: Map<string, WorkflowRun[]>;
  workflowNameCache: Map<string, Map<string, string>>;
  inFlightJobFetch: Map<string, Promise<Job[] | undefined>>;
  jobRefreshTimers: Map<string, NodeJS.Timeout>;
  jobStepsCache: Map<string, Step[]>;
  /** Tracks the last known repo keys to detect changes */
  lastRepoKeys?: Set<string>;
};

let refreshInFlight: Promise<boolean> | undefined;

export function resetRefreshCaches(state: RefreshServiceState): void {
  for (const timer of state.jobRefreshTimers.values()) {
    clearTimeout(timer);
  }
  state.jobRefreshTimers.clear();
  state.inFlightJobFetch.clear();
  state.jobStepsCache.clear();
  state.workflowNameCache.clear();
  state.workspaceProvider.resetJobCaches();
  state.pinnedProvider.resetJobCaches();
  state.lastRepoKeys = undefined;
}

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
 * Creates a GiteaClient with the current settings.
 * Returns undefined if not configured.
 */
async function createClient(state: RefreshServiceState): Promise<GiteaClient | undefined> {
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
  return new GiteaClient({
    baseUrl: settings.baseUrl,
    token: token,
    insecureSkipVerify: settings.insecureSkipVerify
  });
}

/**
 * Ensures API client is available, returns undefined if not configured.
 */
export async function ensureApi(state: RefreshServiceState): Promise<GiteaApi | undefined> {
  const client = await createClient(state);
  if (!client) {
    return undefined;
  }
  return new GiteaApi(client);
}

/**
 * Creates an internal API client for undocumented endpoints.
 * Returns undefined if not configured.
 */
export async function ensureInternalApi(state: RefreshServiceState): Promise<GiteaInternalApi | undefined> {
  const client = await createClient(state);
  if (!client) {
    return undefined;
  }
  return new GiteaInternalApi(client);
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
    state.lastRepoKeys = undefined;
    updateStatusBar('Gitea: not configured');
    return false;
  }

  const settings = getSettings();
  const repos = await resolveRepos(api, state, settings);
  
  // Only call setRepositories when the repo list actually changes
  const newRepoKeys = new Set(repos.map(r => repoKey(r)));
  const reposChanged = hasRepoListChanged(state.lastRepoKeys, newRepoKeys);
  if (reposChanged) {
    state.workspaceProvider.setRepositories(repos);
    state.pinnedProvider.setRepositories(repos);
    state.lastRepoKeys = newRepoKeys;
    logDebug(`Repo list changed, updated tree providers`);
  }
  
  // Update settings view with the first available repo
  state.settingsProvider.setTokenStatus(!!state.cachedToken);
  if (repos.length > 0) {
    const settingsRepo = repos[0];
    state.settingsProvider.setRepository(settingsRepo);
  } else {
    state.settingsProvider.setRepository(undefined);
  }
  let anyRunning = false;

  await runWithLimit(repos, MAX_CONCURRENT_REPOS, async (repo) => {
    // Only set loading state if this is a new repo or repo is in error state
    const key = repoKey(repo);
    const needsLoadingIndicator = !state.lastRepoKeys?.has(key) || 
      state.workspaceProvider.isRepoInErrorState(repo);
    if (needsLoadingIndicator) {
      state.workspaceProvider.setRepoLoading(repo);
      state.pinnedProvider.setRepoLoading(repo);
    }
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
      state.lastRunsByRepo.set(key, limitedRuns);
      logDebug(`Runs fetched for ${repo.owner}/${repo.name}: ${limitedRuns.length} in ${Date.now() - runStart}ms`);
      if (limitedRuns.some((r) => isRunning(r.status))) {
        anyRunning = true;
      }
      // Only fetch jobs for active runs that are expanded or already loaded
      const activeRuns = limitedRuns.filter((r) => isRunning(r.status));
      const runsToPollJobs = activeRuns.filter((run) => shouldPollJobsForRun(state, repo, run.id));
      await runWithLimit(runsToPollJobs, MAX_CONCURRENT_JOBS, async (run) => {
        await fetchJobsForRun(toRunRef(repo, run), state, settings);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.workspaceProvider.setRepoError(repo, message);
      state.pinnedProvider.setRepoError(repo, message);
      logWarn(`Failed to refresh ${repo.owner}/${repo.name}: ${message}`);
    }
  });

  // Retry loading jobs for expanded runs that still need them
  // This handles cases where initial job load failed or user expanded while offline
  const workspaceExpandedNeeding = state.workspaceProvider.getExpandedRunRefsNeedingJobs();
  const pinnedExpandedNeeding = state.pinnedProvider.getExpandedRunRefsNeedingJobs();
  
  // Combine and deduplicate by run key
  const expandedNeedingMap = new Map<string, RunRef>();
  for (const runRef of [...workspaceExpandedNeeding, ...pinnedExpandedNeeding]) {
    const key = `${runRef.repo.owner}/${runRef.repo.name}#${runRef.id}`;
    if (!expandedNeedingMap.has(key)) {
      expandedNeedingMap.set(key, runRef);
    }
  }
  
  if (expandedNeedingMap.size > 0) {
    logDebug(`Retrying job fetch for ${expandedNeedingMap.size} expanded run(s) needing jobs`);
    await runWithLimit(Array.from(expandedNeedingMap.values()), MAX_CONCURRENT_JOBS, async (runRef) => {
      await fetchJobsForRun(runRef, state, settings);
    });
  }

  logDebug(`Refresh cycle completed in ${Date.now() - refreshStarted}ms`);
  updateStatusBar(undefined, state.lastRunsByRepo);
  return anyRunning;
}

/**
 * Checks if the repo list has changed by comparing key sets.
 */
export function hasRepoListChanged(oldKeys: Set<string> | undefined, newKeys: Set<string>): boolean {
  if (!oldKeys) {
    return true; // First load
  }
  if (oldKeys.size !== newKeys.size) {
    return true;
  }
  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      return true;
    }
  }
  return false;
}

async function resolveRepos(
  api: GiteaApi,
  state: RefreshServiceState,
  settings: ExtensionSettings
): Promise<RepoRef[]> {
  let baseHost = '';
  try {
    baseHost = new URL(settings.baseUrl).host;
  } catch {
    baseHost = '';
  }

  const folders = vscode.workspace.workspaceFolders ?? [];

  if (settings.discoveryMode === 'workspace') {
    return discoverWorkspaceRepos(settings.baseUrl, folders);
  } else if (settings.discoveryMode === 'allAccessible') {
    try {
      const repos = await api.listAccessibleRepos();
      return repos.map((repo) => ({
        host: baseHost,
        owner: repo.owner,
        name: repo.name,
        htmlUrl: repo.htmlUrl
      }));
    } catch (err) {
      logWarn(`Failed to list accessible repositories: ${String(err)}`);
      return discoverWorkspaceRepos(settings.baseUrl, folders);
    }
  }

  return [];
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

/**
 * Fetches jobs for a workflow run.
 * 
 * @param runRef - Reference containing repo, run ID, and run number
 * @param state - Refresh service state
 * @param settings - Extension settings
 * @param options - Optional settings:
 *   - refreshOnly: skips loading indicator (for polling refreshes)
 *   - runNode: the actual expanded RunNode instance for proper UI refresh
 */
export async function fetchJobsForRun(
  runRef: RunRef,
  state: RefreshServiceState,
  settings: ExtensionSettings,
  options?: { refreshOnly?: boolean; runNode?: RunNode }
): Promise<Job[] | undefined> {
  const { repo, id: runId } = runRef;
  const key = `${repoKey(repo)}#${runId}`;
  if (state.inFlightJobFetch.has(key)) {
    return state.inFlightJobFetch.get(key);
  }
  const error = await getConfigError(state);
  if (error) {
    state.workspaceProvider.setRunJobsError(repo, runId, error, options?.runNode);
    state.pinnedProvider.setRunJobsError(repo, runId, error, options?.runNode);
    return;
  }
  const api = await ensureApi(state);
  if (!api) {
    return;
  }
  if (!options?.refreshOnly) {
    state.workspaceProvider.setRunJobsLoading(repo, runId, options?.runNode);
    state.pinnedProvider.setRunJobsLoading(repo, runId, options?.runNode);
  }
  const fetchPromise = (async () => {
    try {
      logDebug(`Fetching jobs for ${repo.owner}/${repo.name} run ${runId} (limit=${settings.maxJobsPerRun}, timeout=${JOBS_TIMEOUT_MS}ms)`);
      const start = Date.now();
      // Official API uses database ID
      const jobs = await api.listJobs(repo, runId, { limit: settings.maxJobsPerRun, timeoutMs: JOBS_TIMEOUT_MS });
      // Internal API uses runNumber (falls back to runId if not available)
      // Force refresh steps when doing a refresh (refreshOnly=true) to get updated statuses
      const hydratedCount = await hydrateJobSteps(runRef, jobs, state, { forceRefresh: options?.refreshOnly ?? false });
      const elapsed = Date.now() - start;
      const hydrationNote = hydratedCount ? ` (steps fetched for ${hydratedCount} job${hydratedCount === 1 ? '' : 's'})` : '';
      logDebug(`Fetched ${jobs.length} jobs for ${repo.owner}/${repo.name} run ${runId} in ${elapsed}ms${hydrationNote}`);
      state.workspaceProvider.updateJobs(repo, runId, jobs, options?.runNode);
      state.pinnedProvider.updateJobs(repo, runId, jobs, options?.runNode);
      scheduleJobRefresh(runRef, jobs, state, settings);
      return jobs;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Failed to fetch jobs for ${repo.owner}/${repo.name} run ${runId}: ${message}`);
      state.workspaceProvider.setRunJobsError(repo, runId, message, options?.runNode);
      state.pinnedProvider.setRunJobsError(repo, runId, message, options?.runNode);
    } finally {
      state.inFlightJobFetch.delete(key);
    }
  })();
  state.inFlightJobFetch.set(key, fetchPromise);
  return fetchPromise;
}

/**
 * Hydrates job steps using the internal Gitea API.
 * 
 * This uses undocumented endpoints that are not part of the official API.
 * The internal API uses run number (URL path) and job index (0-based position).
 * 
 * @param runRef - Reference containing repo and run identifiers
 * @param jobs - Jobs to hydrate with step data
 * @param state - Refresh service state
 * @param options - Optional settings (forceRefresh re-fetches steps even if cached)
 */
export async function hydrateJobSteps(
  runRef: RunRef,
  jobs: Job[],
  state: RefreshServiceState,
  options?: { forceRefresh?: boolean }
): Promise<number> {
  const { repo } = runRef;
  // Internal API uses runNumber in URL path, fallback to id if not available
  const internalRunId = runRef.runNumber ?? runRef.id;

  // Find jobs that need step hydration
  // If forceRefresh is true, re-fetch steps for all jobs to get updated statuses
  const jobsToHydrate: Array<{ job: Job; jobIndex: number }> = [];
  jobs.forEach((job, index) => {
    const needsHydration = !job.steps || job.steps.length === 0;
    const isActive = isJobActive(job.status);
    // Force refresh for active jobs (they're still running) or when explicitly requested
    const shouldForceRefresh = options?.forceRefresh || isActive;
    
    if (needsHydration || shouldForceRefresh) {
      jobsToHydrate.push({ job, jobIndex: index });
    }
  });

  if (!jobsToHydrate.length) {
    return 0;
  }

  // Create internal API client
  const internalApi = await ensureInternalApi(state);
  if (!internalApi) {
    logWarn(`Failed to create internal API client for step hydration`);
    return 0;
  }

  const hydrateStart = Date.now();
  await runWithLimit(jobsToHydrate, MAX_CONCURRENT_JOBS, async ({ job, jobIndex }) => {
    const cacheKey = `${repo.owner}/${repo.name}#${internalRunId}#${jobIndex}`;
    const isActive = isJobActive(job.status);
    // Only use cache if not forcing refresh and job is not active
    // Active jobs need fresh data, and forceRefresh means we want latest status
    const shouldUseCache = !options?.forceRefresh && !isActive;
    const cachedSteps = shouldUseCache ? state.jobStepsCache.get(cacheKey) : undefined;
    
    if (cachedSteps?.length) {
      job.steps = cachedSteps;
      return;
    }
    try {
      logDebug(`Fetching steps via internal API for job ${jobIndex} (${job.name}) in ${repo.owner}/${repo.name} run ${internalRunId}`);
      const result = await internalApi.getJobWithSteps(repo, internalRunId, jobIndex);
      if (result.steps?.length) {
        job.steps = result.steps;
        state.jobStepsCache.set(cacheKey, result.steps);
        logDebug(`Fetched ${result.steps.length} steps for job ${jobIndex} (${job.name}) in ${repo.owner}/${repo.name} run ${internalRunId}`);
      } else {
        logWarn(`Internal API returned no steps for job ${jobIndex} (${job.name}) in ${repo.owner}/${repo.name} run ${internalRunId}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Failed to fetch steps via internal API for job ${jobIndex} (${job.name}) in ${repo.owner}/${repo.name} run ${internalRunId}: ${message}`);
    }
  });
  logDebug(`Hydrated steps for ${jobsToHydrate.length} job(s) in ${repo.owner}/${repo.name} run ${internalRunId} in ${Date.now() - hydrateStart}ms`);
  return jobsToHydrate.length;
}

/**
 * Schedules a delayed refresh for active jobs.
 * 
 * @param runRef - Reference to the workflow run
 * @param jobs - Current jobs for the run
 * @param state - Refresh service state
 * @param settings - Extension settings
 */
export function scheduleJobRefresh(
  runRef: RunRef,
  jobs: Job[],
  state: RefreshServiceState,
  settings: ExtensionSettings
): void {
  const { repo, id: runId } = runRef;
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
    void fetchJobsForRun(runRef, state, settings, { refreshOnly: true });
  }, settings.jobsIntervalSeconds * 1000);
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

function shouldPollJobsForRun(state: RefreshServiceState, repo: RepoRef, runId: number | string): boolean {
  return state.workspaceProvider.shouldPollJobs(repo, runId) || state.pinnedProvider.shouldPollJobs(repo, runId);
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
