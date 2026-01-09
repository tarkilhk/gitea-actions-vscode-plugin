import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { RepoRef, Job } from '../gitea/models';
import { LOG_POLL_INTERVAL_MS, JOBS_TIMEOUT_MS } from '../config/constants';
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
 * Builds a URI for a log document.
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
  hydrateJobSteps: (api: GiteaApi, repo: RepoRef, runId: number | string, jobs: Job[]) => Promise<number>;
  scheduleJobRefresh: (repo: RepoRef, runId: number | string, jobs: Job[]) => void;
};

/**
 * Starts streaming logs for a job, polling until the job completes.
 */
export async function startLogStream(
  api: GiteaApi,
  uri: vscode.Uri,
  repo: RepoRef,
  runId: number | string | undefined,
  jobId: number | string,
  deps: LogStreamDependencies
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
        deps.logContentProvider.update(uri, content);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logContentProvider.update(uri, `Failed to load logs: ${message}`);
    }

    let active = true;
    if (runId !== undefined) {
      try {
        const settings = deps.getSettings();
        const jobs = await api.listJobs(repo, runId, { limit: settings.maxJobsPerRun, timeoutMs: JOBS_TIMEOUT_MS });
        await deps.hydrateJobSteps(api, repo, runId, jobs);
        deps.updateJobs(repo, runId, jobs);
        deps.scheduleJobRefresh(repo, runId, jobs);
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
    await sleep(LOG_POLL_INTERVAL_MS);
  }

  stopLogStream(uri);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
