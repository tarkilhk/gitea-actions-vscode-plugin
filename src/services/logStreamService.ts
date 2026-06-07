import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { GiteaInternalApi } from '../gitea/internalApi';
import { RepoRef, RunRef, Job, Step } from '../gitea/models';
import { ExtractedStepLog, extractStepLogFromJobLog } from '../gitea/logs';
import { JOBS_TIMEOUT_MS } from '../config/constants';
import { normalizeStatus } from '../util/status';
import { ExtensionSettings } from '../config/settings';
import { logInfo, logWarn } from '../util/logging';

/**
 * Scrolls the active editor showing the given log URI to the last line,
 * so streaming logs stay in view without manual scrolling.
 */
function scrollLogEditorToEnd(uri: vscode.Uri): void {
  const key = uri.toString();
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === key
  );
  if (!editor) {
    return;
  }
  const doc = editor.document;
  const lastLine = Math.max(0, doc.lineCount - 1);
  const line = doc.lineAt(lastLine);
  const range = new vscode.Range(lastLine, 0, lastLine, line.text.length);
  editor.revealRange(range, vscode.TextEditorRevealType.Default);
}

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
    // After VS Code refreshes the document, scroll the editor to the last line
    // so streaming logs stay in view without manual scrolling.
    setTimeout(() => scrollLogEditorToEnd(uri), 50);
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
  logInfo(`Starting live job log stream for ${runRef?.repo.owner ?? 'unknown'}/${runRef?.repo.name ?? 'unknown'} job ${jobId}`);
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

async function getOfficialStepLog(
  api: GiteaApi,
  runRef: RunRef,
  job: Job,
  stepIndex: number
): Promise<ExtractedStepLog | undefined> {
  const jobLog = await api.getJobLogs(runRef.repo, job.id);
  return extractStepLogFromJobLog(jobLog, job.steps, stepIndex);
}

function internalRunCandidates(runRef: RunRef, job: Job): Array<number | string> {
  const candidates: Array<number | string | undefined> = [runRef.runNumber];
  const runMatch = job.htmlUrl?.match(/\/actions\/runs\/([^/?#]+)/);
  if (runMatch) {
    candidates.push(decodeURIComponent(runMatch[1]));
  }
  candidates.push(runRef.id);

  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is number | string => {
    if (candidate == null) {
      return false;
    }
    const key = String(candidate);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function getInternalStepLog(
  internalApi: GiteaInternalApi | undefined,
  runRef: RunRef,
  job: Job,
  jobIndex: number,
  stepIndex: number,
  totalSteps: number
): Promise<{ content?: string; error?: string }> {
  if (!internalApi) {
    return { error: 'internal API client unavailable' };
  }

  let lastError: string | undefined;
  for (const runId of internalRunCandidates(runRef, job)) {
    try {
      const stepLog = await internalApi.getStepLogs(runRef.repo, runId, jobIndex, stepIndex, totalSteps);
      if (stepLog) {
        return { content: GiteaInternalApi.formatStepLogs(stepLog) };
      }
      lastError = `no step log returned for run ${runId}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { error: lastError ?? 'run number unavailable' };
}

/**
 * Fetches and displays logs for a specific step.
 *
 * Gitea 1.26 exposes official step metadata but still documents only a
 * job-level log download, so we first split the official job log locally and
 * then fall back to the internal web UI endpoint.
 * 
 * @param api Official API client
 * @param internalApi Internal API client fallback
 * @param uri Virtual document URI
 * @param runRef Reference to the workflow run
 * @param jobIndex 0-based job index
 * @param stepIndex 0-based step index
 * @param totalSteps Total number of steps in the job
 * @param deps Dependencies
 */
export async function fetchStepLogs(
  api: GiteaApi,
  internalApi: GiteaInternalApi | undefined,
  uri: vscode.Uri,
  runRef: RunRef,
  job: Job,
  jobIndex: number,
  stepIndex: number,
  totalSteps: number,
  deps: StepLogStreamDependencies
): Promise<void> {
  logInfo(`Fetching step logs for ${runRef.repo.owner}/${runRef.repo.name} job ${job.id} step ${stepIndex}`);
  let officialFallback: ExtractedStepLog | undefined;
  let officialError: string | undefined;

  try {
    const official = await getOfficialStepLog(api, runRef, job, stepIndex);
    if (official?.exact) {
      deps.logContentProvider.update(uri, official.content);
      return;
    }
    officialFallback = official;
  } catch (error) {
    officialError = error instanceof Error ? error.message : String(error);
  }

  const internal = await getInternalStepLog(internalApi, runRef, job, jobIndex, stepIndex, totalSteps);
  if (internal.content) {
    deps.logContentProvider.update(uri, internal.content);
    return;
  }
  if (internal.error && !officialFallback) {
    logWarn(`Failed to load step logs for ${runRef.repo.owner}/${runRef.repo.name} job ${job.id} step ${stepIndex}: official API${officialError ? ` (${officialError})` : ''}; internal API (${internal.error})`);
    deps.logContentProvider.update(
      uri,
      `Failed to load step logs: official API${officialError ? ` (${officialError})` : ''}; internal API (${internal.error})`
    );
    return;
  }

  if (officialFallback) {
    deps.logContentProvider.update(uri, officialFallback.content);
    return;
  }

  deps.logContentProvider.update(uri, `Failed to load step logs${officialError ? `: ${officialError}` : ''}`);
}

/**
 * Starts streaming logs for a specific step, polling until the step/job completes.
 * 
 * @param api Official API client
 * @param internalApi Internal API client fallback
 * @param uri Virtual document URI
 * @param runRef Reference to the workflow run
 * @param jobIndex 0-based job index
 * @param stepIndex 0-based step index
 * @param totalSteps Total number of steps in the job
 * @param isActive Function to check if the step is still active
 * @param deps Dependencies
 */
export async function startStepLogStream(
  api: GiteaApi,
  internalApi: GiteaInternalApi | undefined,
  uri: vscode.Uri,
  runRef: RunRef,
  job: Job,
  jobIndex: number,
  stepIndex: number,
  totalSteps: number,
  isActive: () => boolean,
  deps: StepLogStreamDependencies
): Promise<void> {
  logInfo(`Starting live step log stream for ${runRef.repo.owner}/${runRef.repo.name} job ${job.id} step ${stepIndex}`);
  stopLogStream(uri);
  const controller = { stopped: false };
  liveLogStreams.set(uri.toString(), controller);

  let lastContent = '';
  while (!controller.stopped && isActive()) {
    let officialFallback: ExtractedStepLog | undefined;
    try {
      const official = await getOfficialStepLog(api, runRef, job, stepIndex);
      if (official?.exact) {
        if (official.content !== lastContent) {
          lastContent = official.content;
          deps.logContentProvider.update(uri, official.content);
        }
      } else {
        officialFallback = official;
      }
    } catch {
      // Fall back to the internal web UI API below.
    }

    if (!lastContent || officialFallback) {
      const internal = await getInternalStepLog(internalApi, runRef, job, jobIndex, stepIndex, totalSteps);
      const content = internal.content ?? officialFallback?.content ?? `Failed to load step logs: ${internal.error ?? 'unknown error'}`;
      if (content !== lastContent) {
        lastContent = content;
        deps.logContentProvider.update(uri, content);
      }
    }

    const settings = deps.getSettings();
    await sleep(settings.logPollIntervalSeconds * 1000);
  }

  // Final fetch after loop ends
  if (!controller.stopped) {
    await fetchStepLogs(api, internalApi, uri, runRef, job, jobIndex, stepIndex, totalSteps, deps);
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
