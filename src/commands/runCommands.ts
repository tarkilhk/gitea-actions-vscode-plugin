import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { GiteaInternalApi } from '../gitea/internalApi';
import { RepoRef, RunRef, Step } from '../gitea/models';
import { ActionsNode, StepNode, JobNode } from '../views/nodes';

export type LogStreamContext = {
  getConfigError: () => Promise<string | undefined>;
  ensureApi: () => Promise<GiteaApi | undefined>;
  ensureInternalApi: () => Promise<GiteaInternalApi | undefined>;
  logContentProvider: {
    update: (uri: vscode.Uri, content: string) => void;
  };
  startLogStream: (
    api: GiteaApi,
    uri: vscode.Uri,
    runRef: RunRef | undefined,
    jobId: number | string
  ) => Promise<void>;
  fetchStepLogs: (
    internalApi: GiteaInternalApi,
    uri: vscode.Uri,
    runRef: RunRef,
    jobIndex: number,
    stepIndex: number,
    totalSteps: number
  ) => Promise<void>;
  startStepLogStream: (
    internalApi: GiteaInternalApi,
    uri: vscode.Uri,
    runRef: RunRef,
    jobIndex: number,
    stepIndex: number,
    totalSteps: number,
    isActive: () => boolean
  ) => Promise<void>;
  buildLogUri: (
    repo: RepoRef,
    runId: number | string,
    jobId: number | string,
    stepId?: number | string
  ) => vscode.Uri;
  buildStepLogUri: (
    repo: RepoRef,
    runId: number | string,
    jobIndex: number,
    stepIndex: number,
    stepName: string
  ) => vscode.Uri;
  isJobActive: (status?: string) => boolean;
  isStepActive: (step: Step) => boolean;
};

/**
 * Views logs for a job or step.
 * For steps, uses the internal API to fetch step-specific logs.
 */
export async function viewJobLogs(
  node: ActionsNode,
  ctx: LogStreamContext
): Promise<void> {
  if (node.type === 'step') {
    await viewStepLogs(node, ctx);
  } else if (node.type === 'job') {
    await viewJobLogsInternal(node, ctx);
  }
  // Other node types don't support log viewing
}

/**
 * Views logs for a job node.
 */
async function viewJobLogsInternal(
  node: JobNode,
  ctx: LogStreamContext
): Promise<void> {
  const error = await ctx.getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`Cannot fetch logs; ${error.toLowerCase()} first.`);
    return;
  }
  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }

  const { runRef, job } = node;
  const { repo, id: runId } = runRef;
  const shouldStream = ctx.isJobActive(job.status);
  const uri = ctx.buildLogUri(repo, runId, job.id);
  ctx.logContentProvider.update(uri, 'Loading logs...');

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.languages.setTextDocumentLanguage(doc, 'log');

  if (shouldStream) {
    ctx.startLogStream(api, uri, runRef, job.id).catch((err) =>
      vscode.window.showErrorMessage(`Live log stream stopped: ${err instanceof Error ? err.message : String(err)}`)
    );
  } else {
    try {
      const content = await api.getJobLogs(repo, job.id);
      ctx.logContentProvider.update(uri, content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logContentProvider.update(uri, `Failed to load logs: ${message}`);
      vscode.window.showErrorMessage(`Failed to load logs: ${message}`);
    }
  }
}

/**
 * Views logs for a specific step using the internal API.
 */
async function viewStepLogs(
  node: StepNode,
  ctx: LogStreamContext
): Promise<void> {
  const error = await ctx.getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`Cannot fetch logs; ${error.toLowerCase()} first.`);
    return;
  }

  const internalApi = await ctx.ensureInternalApi();
  if (!internalApi) {
    vscode.window.showErrorMessage('Failed to initialize API client.');
    return;
  }

  const { runRef, job, step, jobIndex, stepIndex } = node;
  const { repo, id: runId } = runRef;
  const totalSteps = job.steps?.length ?? 1;
  const stepName = step.name || `Step ${stepIndex}`;

  const uri = ctx.buildStepLogUri(repo, runId, jobIndex, stepIndex, stepName);
  ctx.logContentProvider.update(uri, `Loading logs for step: ${stepName}...`);

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.languages.setTextDocumentLanguage(doc, 'log');

  const shouldStream = ctx.isStepActive(step);

  if (shouldStream) {
    // Stream logs while step is active
    ctx.startStepLogStream(
      internalApi,
      uri,
      runRef,
      jobIndex,
      stepIndex,
      totalSteps,
      () => ctx.isStepActive(step)
    ).catch((err) =>
      vscode.window.showErrorMessage(`Live step log stream stopped: ${err instanceof Error ? err.message : String(err)}`)
    );
  } else {
    // Fetch logs once for completed step
    await ctx.fetchStepLogs(internalApi, uri, runRef, jobIndex, stepIndex, totalSteps);
  }
}

export async function openInBrowser(node: ActionsNode): Promise<void> {
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
