import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { GiteaInternalApi } from '../gitea/internalApi';
import { RepoRef, RunRef, Job, Step } from '../gitea/models';
import { JOBS_TIMEOUT_MS } from '../config/constants';
import { normalizeStatus } from '../util/status';
import { ExtensionSettings } from '../config/settings';

/**
 * Provides content for virtual log documents.
 */
export class LiveLogContentProvider implements vscode.TextDocumentContentProvider {
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

const liveLogStreams = new Map<string, { stopped: boolean }>();

/**
 * Builds a URI for a job log document.
 */
export function buildLogUri(
  repo: RepoRef,
  runId: number | string,
  jobId: number | string,
  stepId?: number | string
): vscode.Uri {
  const owner = encodeURIComponent(repo.owner);
  const name = encodeURIComponent(repo.name);
  const stepPart = stepId ? `/step-${encodeURIComponent(String(stepId))}` : '';
  return vscode.Uri.parse(`gitea-actions-log://${owner}/${name}/run-${runId}/job-${jobId}${stepPart}`);
}

/**
 * Builds a URI for a step-specific log document.
 * Uses job index and step index for internal API compatibility.
 */
export function buildStepLogUri(
  repo: RepoRef,
  runId: number | string,
  jobIndex: number,
  stepIndex: number,
  stepName: string
): vscode.Uri {
  const owner = encodeURIComponent(repo.owner);
  const name = encodeURIComponent(repo.name);
  const safeName = encodeURIComponent(stepName.replace(/[/\\]/g, '-'));
  return vscode.Uri.parse(`gitea-actions-log://${owner}/${name}/run-${runId}/job-${jobIndex}/step-${stepIndex}-${safeName}`);
}

/**
 * Stops an active log stream.
 */
export function stopLogStream(uri: vscode.Uri): void {
  const key = uri.toString();
  const stream = liveLogStreams.get(key);
  if (stream) {
    stream.stopped = true;
    liveLogStreams.delete(key);
  }
}

/**
 * Checks if a job is actively running or queued.
 */
export function isJobActive(status?: string): boolean {
  const normalized = normalizeStatus(status);
  return normalized === 'running' || normalized === 'queued';
}

export type LogStreamDependencies = {
  logContentProvider: LiveLogContentProvider;
  getSettings: () => ExtensionSettings;
  updateJobs: (repo: RepoRef, runId: number | string, jobs: Job[]) => void;
  hydrateJobSteps: (runRef: RunRef, jobs: Job[], options?: { forceRefresh?: boolean }) => Promise<number>;
  scheduleJobRefresh: (runRef: RunRef, jobs: Job[]) => void;
};

/**
 * Starts streaming logs for a job, polling until the job completes.
 * 
 * @param api - Gitea API client
 * @param uri - Virtual document URI
 * @param runRef - Reference to the workflow run (or undefined for jobs without run context)
 * @param jobId - Job ID to stream logs for
 * @param deps - Dependencies
 */
export async function startLogStream(
  api: GiteaApi,
  uri: vscode.Uri,
  runRef: RunRef | undefined,
  jobId: number | string,
  deps: LogStreamDependencies
): Promise<void> {
  stopLogStream(uri);
  const controller = { stopped: false };
  liveLogStreams.set(uri.toString(), controller);

  const repo = runRef?.repo;
  let lastContent = '';
  while (!controller.stopped) {
    try {
      if (repo) {
        const content = await api.getJobLogs(repo, jobId);
        if (content !== lastContent) {
          lastContent = content;
          deps.logContentProvider.update(uri, content);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logContentProvider.update(uri, `Failed to load logs: ${message}`);
    }

    let active = true;
    if (runRef && repo) {
      try {
        const settings = deps.getSettings();
        const jobs = await api.listJobs(repo, runRef.id, { limit: settings.maxJobsPerRun, timeoutMs: JOBS_TIMEOUT_MS });
        // Force refresh steps when actively monitoring to get updated statuses
        await deps.hydrateJobSteps(runRef, jobs, { forceRefresh: true });
        deps.updateJobs(repo, runRef.id, jobs);
        deps.scheduleJobRefresh(runRef, jobs);
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
    const settings = deps.getSettings();
    await sleep(settings.logPollIntervalSeconds * 1000);
  }

  stopLogStream(uri);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dependencies for step log streaming.
 */
export type StepLogStreamDependencies = {
  logContentProvider: LiveLogContentProvider;
  getSettings: () => ExtensionSettings;
};

/**
 * Fetches and displays logs for a specific step using the internal API.
 * 
 * @param internalApi Internal API client
 * @param uri Virtual document URI
 * @param runRef Reference to the workflow run
 * @param jobIndex 0-based job index
 * @param stepIndex 0-based step index
 * @param totalSteps Total number of steps in the job
 * @param deps Dependencies
 */
export async function fetchStepLogs(
  internalApi: GiteaInternalApi,
  uri: vscode.Uri,
  runRef: RunRef,
  jobIndex: number,
  stepIndex: number,
  totalSteps: number,
  deps: StepLogStreamDependencies
): Promise<void> {
  // Internal API may use run id or run_number in URL path (Gitea versions differ); try id first
  const internalRunId = runRef.id;
  const fallbackRunId = runRef.runNumber != null && runRef.runNumber !== runRef.id ? runRef.runNumber : undefined;
  try {
    let stepLog = await internalApi.getStepLogs(runRef.repo, internalRunId, jobIndex, stepIndex, totalSteps);
    if (!stepLog && fallbackRunId !== undefined) {
      stepLog = await internalApi.getStepLogs(runRef.repo, fallbackRunId, jobIndex, stepIndex, totalSteps);
    }
    if (stepLog) {
      const content = GiteaInternalApi.formatStepLogs(stepLog);
      deps.logContentProvider.update(uri, content);
    } else {
      deps.logContentProvider.update(uri, '(No log output for this step)');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('404') && fallbackRunId !== undefined) {
      try {
        const stepLog = await internalApi.getStepLogs(runRef.repo, fallbackRunId, jobIndex, stepIndex, totalSteps);
        if (stepLog) {
          deps.logContentProvider.update(uri, GiteaInternalApi.formatStepLogs(stepLog));
          return;
        }
      } catch {
        // fall through to error message
      }
    }
    deps.logContentProvider.update(uri, `Failed to load step logs: ${message}`);
  }
}

/**
 * Starts streaming logs for a specific step, polling until the step/job completes.
 * 
 * @param internalApi Internal API client
 * @param uri Virtual document URI
 * @param runRef Reference to the workflow run
 * @param jobIndex 0-based job index
 * @param stepIndex 0-based step index
 * @param totalSteps Total number of steps in the job
 * @param isActive Function to check if the step is still active
 * @param deps Dependencies
 */
export async function startStepLogStream(
  internalApi: GiteaInternalApi,
  uri: vscode.Uri,
  runRef: RunRef,
  jobIndex: number,
  stepIndex: number,
  totalSteps: number,
  isActive: () => boolean,
  deps: StepLogStreamDependencies
): Promise<void> {
  stopLogStream(uri);
  const controller = { stopped: false };
  liveLogStreams.set(uri.toString(), controller);

  // Internal API may use run id or run_number (Gitea versions differ); try id first, switch to run_number on 404
  let internalRunId: number | string = runRef.id;
  const fallbackRunId = runRef.runNumber != null && runRef.runNumber !== runRef.id ? runRef.runNumber : undefined;
  let lastContent = '';
  while (!controller.stopped && isActive()) {
    try {
      const stepLog = await internalApi.getStepLogs(runRef.repo, internalRunId, jobIndex, stepIndex, totalSteps);
      if (stepLog) {
        const content = GiteaInternalApi.formatStepLogs(stepLog);
        if (content !== lastContent) {
          lastContent = content;
          deps.logContentProvider.update(uri, content);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('404') && fallbackRunId !== undefined) {
        internalRunId = fallbackRunId;
        try {
          const stepLog = await internalApi.getStepLogs(runRef.repo, internalRunId, jobIndex, stepIndex, totalSteps);
          if (stepLog) {
            const content = GiteaInternalApi.formatStepLogs(stepLog);
            lastContent = content;
            deps.logContentProvider.update(uri, content);
          }
        } catch {
          deps.logContentProvider.update(uri, `Failed to load step logs: ${message}`);
        }
      } else {
        deps.logContentProvider.update(uri, `Failed to load step logs: ${message}`);
      }
    }

    const settings = deps.getSettings();
    await sleep(settings.logPollIntervalSeconds * 1000);
  }

  // Final fetch after loop ends
  if (!controller.stopped) {
    try {
      const stepLog = await internalApi.getStepLogs(runRef.repo, internalRunId, jobIndex, stepIndex, totalSteps);
      if (stepLog) {
        const content = GiteaInternalApi.formatStepLogs(stepLog);
        deps.logContentProvider.update(uri, content);
      }
    } catch {
      // Ignore final fetch errors
    }
  }

  stopLogStream(uri);
}

/**
 * Checks if a step is actively running or queued.
 */
export function isStepActive(step: Step): boolean {
  const normalized = normalizeStatus(step.status);
  return normalized === 'running' || normalized === 'queued';
}
