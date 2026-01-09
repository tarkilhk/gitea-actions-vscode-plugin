import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { RepoRef, Job, Step, PinnedRepo } from '../gitea/models';
import { ActionsNode } from '../views/nodes';
import { savePinned } from '../gitea/discovery';

export type RunCommandContext = {
  showToast: (message: string, type?: 'info' | 'warning' | 'error') => void;
  getConfigError: () => Promise<string | undefined>;
  ensureApi: () => Promise<GiteaApi | undefined>;
  scheduleRefresh: () => void;
  getPinnedRepos: () => PinnedRepo[];
  setPinnedRepos: (repos: PinnedRepo[]) => void;
};

export type LogStreamContext = {
  getConfigError: () => Promise<string | undefined>;
  ensureApi: () => Promise<GiteaApi | undefined>;
  logContentProvider: {
    update: (uri: vscode.Uri, content: string) => void;
  };
  startLogStream: (
    api: GiteaApi,
    uri: vscode.Uri,
    repo: RepoRef,
    runId: number | string | undefined,
    jobId: number | string
  ) => Promise<void>;
  buildLogUri: (
    repo: RepoRef,
    runId: number | string,
    jobId: number | string,
    stepId?: number | string
  ) => vscode.Uri;
  isJobActive: (status?: string) => boolean;
};

export async function viewJobLogs(
  node: { job: Job; repo: RepoRef; runId?: number | string; step?: Step },
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
  const runId = node.runId ?? (node as { run?: { id?: number | string } }).run?.id;
  const jobId = node.job.id;
  const shouldStream = ctx.isJobActive(node.job.status);
  const uri = ctx.buildLogUri(node.repo, runId ?? 'run', jobId, node.step?.name ?? node.step?.id);
  ctx.logContentProvider.update(uri, 'Loading logs...');

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.languages.setTextDocumentLanguage(doc, 'log');

  if (shouldStream) {
    ctx.startLogStream(api, uri, node.repo, runId, jobId).catch((err) =>
      vscode.window.showErrorMessage(`Live log stream stopped: ${err instanceof Error ? err.message : String(err)}`)
    );
  } else {
    try {
      const content = await api.getJobLogs(node.repo, jobId);
      ctx.logContentProvider.update(uri, content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logContentProvider.update(uri, `Failed to load logs: ${message}`);
      vscode.window.showErrorMessage(`Failed to load logs: ${message}`);
    }
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

export async function pinRepo(
  extensionContext: vscode.ExtensionContext,
  repo: RepoRef,
  ctx: RunCommandContext
): Promise<void> {
  const pinnedRepos = ctx.getPinnedRepos();
  if (pinnedRepos.find((r) => r.owner === repo.owner && r.name === repo.name)) {
    return;
  }
  const newPinned = [...pinnedRepos, { owner: repo.owner, name: repo.name }];
  ctx.setPinnedRepos(newPinned);
  await savePinned(extensionContext.globalState, newPinned);
  ctx.showToast(`Pinned ${repo.owner}/${repo.name}.`);
  ctx.scheduleRefresh();
}

export async function unpinRepo(
  extensionContext: vscode.ExtensionContext,
  repo: RepoRef,
  ctx: RunCommandContext
): Promise<void> {
  const pinnedRepos = ctx.getPinnedRepos();
  const newPinned = pinnedRepos.filter((r) => !(r.owner === repo.owner && r.name === repo.name));
  ctx.setPinnedRepos(newPinned);
  await savePinned(extensionContext.globalState, newPinned);
  ctx.showToast(`Unpinned ${repo.owner}/${repo.name}.`);
  ctx.scheduleRefresh();
}
