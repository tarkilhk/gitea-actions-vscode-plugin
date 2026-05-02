import * as vscode from 'vscode';
import { RepoRef, WorkflowRun } from '../gitea/models';
import { TOAST_TIMEOUT_MS } from '../config/constants';
import { normalizeStatus } from '../util/status';

type PinnedWorkflow = {
  repo: RepoRef;
  workflowName: string;
};

const PINNED_WORKFLOWS_KEY = 'giteaActions.pinnedWorkflows';
let statusBarItem: vscode.StatusBarItem | undefined;
let pinnedStorage: vscode.Memento | undefined;
let pinnedWorkflows: PinnedWorkflow[] = [];
const pinnedStatusItems = new Map<string, vscode.StatusBarItem>();

function pinnedKey(workflow: PinnedWorkflow): string {
  return `${workflow.repo.owner}/${workflow.repo.name}::${workflow.workflowName}`;
}

function workflowTimestamp(run: WorkflowRun): string {
  return run.updatedAt ?? run.completedAt ?? run.startedAt ?? run.createdAt ?? '';
}

function latestRunForPinned(lastRunsByRepo: Map<string, WorkflowRun[]>, pinned: PinnedWorkflow): WorkflowRun | undefined {
  // Must match refreshService.repoKey / ActionsTreeProvider repo keys used for lastRunsByRepo
  const mapKey = `${pinned.repo.owner}/${pinned.repo.name}`;
  const runs = lastRunsByRepo.get(mapKey) ?? [];
  return runs
    .filter((run) => (run.workflowName ?? run.name) === pinned.workflowName)
    .sort((a, b) => workflowTimestamp(b).localeCompare(workflowTimestamp(a)))[0];
}

function iconForRun(run: WorkflowRun | undefined): string {
  if (!run) return '$(question)';
  if (run.status === 'running') return '$(sync~spin)';
  if (run.status === 'queued') return '$(clock)';
  if (run.conclusion === 'success') return '$(pass)';
  if (run.conclusion === 'failure') return '$(error)';
  if (run.conclusion === 'cancelled') return '$(circle-slash)';
  return '$(circle-outline)';
}

export function initStatusBar(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'workbench.view.extension.giteaActions';
  statusBarItem.text = 'Gitea: idle';
  statusBarItem.show();
  return statusBarItem;
}

export function initPinnedWorkflows(storage: vscode.Memento): void {
  pinnedStorage = storage;
  const raw = storage.get<PinnedWorkflow[]>(PINNED_WORKFLOWS_KEY, []);
  pinnedWorkflows = Array.isArray(raw) ? raw : [];
}

export function pinWorkflow(repo: RepoRef, workflowName: string): Thenable<void> {
  const target: PinnedWorkflow = { repo, workflowName };
  const key = pinnedKey(target);
  if (!pinnedWorkflows.some((w) => pinnedKey(w) === key)) {
    pinnedWorkflows.push(target);
  }
  return pinnedStorage?.update(PINNED_WORKFLOWS_KEY, pinnedWorkflows) ?? Promise.resolve();
}

export function unpinWorkflow(repo: RepoRef, workflowName: string): Thenable<void> {
  const key = `${repo.owner}/${repo.name}::${workflowName}`;
  pinnedWorkflows = pinnedWorkflows.filter((w) => pinnedKey(w) !== key);
  const existing = pinnedStatusItems.get(key);
  if (existing) {
    existing.dispose();
    pinnedStatusItems.delete(key);
  }
  return pinnedStorage?.update(PINNED_WORKFLOWS_KEY, pinnedWorkflows) ?? Promise.resolve();
}

export function isWorkflowPinned(repo: RepoRef, workflowName: string): boolean {
  const key = `${repo.owner}/${repo.name}::${workflowName}`;
  return pinnedWorkflows.some((w) => pinnedKey(w) === key);
}

export function getStatusBarItem(): vscode.StatusBarItem | undefined {
  return statusBarItem;
}

export function updateStatusBar(text?: string, lastRunsByRepo?: Map<string, WorkflowRun[]>): void {
  if (!statusBarItem) {
    return;
  }
  if (text) {
    statusBarItem.text = text;
    statusBarItem.tooltip = 'Gitea Actions';
    statusBarItem.show();
    return;
  }
  if (!lastRunsByRepo) {
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

  const activeKeys = new Set<string>();
  pinnedWorkflows.forEach((pinned, idx) => {
    const key = pinnedKey(pinned);
    activeKeys.add(key);
    const run = latestRunForPinned(lastRunsByRepo, pinned);
    let item = pinnedStatusItems.get(key);
    if (!item) {
      item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99 - idx);
      pinnedStatusItems.set(key, item);
    }
    item.text = `${iconForRun(run)} ${pinned.workflowName}`;
    item.tooltip = run
      ? `${pinned.repo.owner}/${pinned.repo.name}\n${pinned.workflowName} #${run.runNumber ?? run.id}\n${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}`
      : `${pinned.repo.owner}/${pinned.repo.name}\n${pinned.workflowName}\nNo runs found`;
    item.command = run?.htmlUrl
      ? {
          title: 'Open Workflow Run',
          command: 'vscode.open',
          arguments: [vscode.Uri.parse(run.htmlUrl)]
        }
      : 'workbench.view.extension.giteaActions';
    item.show();
  });

  for (const [key, item] of pinnedStatusItems.entries()) {
    if (!activeKeys.has(key)) {
      item.dispose();
      pinnedStatusItems.delete(key);
    }
  }
}

export function isRunning(status?: string): boolean {
  const normalized = normalizeStatus(status);
  return normalized === 'running' || normalized === 'queued';
}

export function showToast(message: string, type: 'info' | 'warning' | 'error' = 'info', timeoutMs: number = TOAST_TIMEOUT_MS): void {
  if (type === 'warning') {
    void vscode.window.showWarningMessage(message);
  } else if (type === 'error') {
    void vscode.window.showErrorMessage(message);
  } else {
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
