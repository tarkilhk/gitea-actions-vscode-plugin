import * as vscode from 'vscode';
import { Job, RepoRef, WorkflowRun } from '../gitea/models';
import { iconForJob, iconForRun, repoIcon, errorIcon, infoIcon } from './icons';
import { formatAgo, formatDateTime, formatDuration } from '../util/time';

export type RepoNode = {
  type: 'repo';
  repo: RepoRef;
  pinned: boolean;
  state: 'idle' | 'loading' | 'error';
  error?: string;
  hasRuns: boolean;
};

export type RunNode = {
  type: 'run';
  repo: RepoRef;
  run: WorkflowRun;
};

export type JobNode = {
  type: 'job';
  repo: RepoRef;
  runId: number | string;
  job: Job;
};

export type MessageNode = {
  type: 'message';
  repo?: RepoRef;
  message: string;
  severity: 'info' | 'error';
};

export type ActionsNode = RepoNode | RunNode | JobNode | MessageNode;

function shortSha(sha?: string): string {
  return sha ? sha.substring(0, 7) : '';
}

function eventIcon(event?: string): string {
  const lower = (event ?? '').toLowerCase();
  if (lower === 'pull_request' || lower === 'pull-request' || lower === 'pr') {
    return '$(git-pull-request) ';
  }
  if (lower === 'push') {
    return '$(git-commit) ';
  }
  return '';
}

export function toTreeItem(node: ActionsNode): vscode.TreeItem {
  switch (node.type) {
    case 'repo': {
      const item = new vscode.TreeItem(`${node.repo.owner}/${node.repo.name}`, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = node.pinned ? 'giteaRepoPinned' : 'giteaRepo';
      item.iconPath = repoIcon;
      if (node.state === 'loading') {
        item.description = 'Loading...';
      } else if (node.state === 'error') {
        item.description = 'Error';
        item.tooltip = node.error;
      }
      return item;
    }
    case 'run': {
      const { run } = node;
      const labelPrefix = eventIcon(run.event);
      const label = `${labelPrefix}${run.name}`;
      const metaParts: string[] = [];
      if (run.runNumber) {
        const attempt = run.runAttempt && run.runAttempt > 1 ? ` (attempt ${run.runAttempt})` : '';
        metaParts.push(`#${run.runNumber}${attempt}`);
      }
      if (run.branch) {
        metaParts.push(run.branch);
      }
      if (run.sha) {
        metaParts.push(shortSha(run.sha));
      }
      const duration = formatDuration(run.startedAt ?? run.createdAt, run.completedAt ?? run.updatedAt);
      if (duration) {
        metaParts.push(duration);
      }
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `run-${run.id}`;
      item.iconPath = iconForRun(run);
      const updated = formatAgo(run.updatedAt ?? run.completedAt ?? run.createdAt);
      item.description = metaParts.length ? metaParts.join(' · ') : updated;
      item.tooltip = [
        run.name,
        run.event ? `Event: ${run.event}` : '',
        run.runNumber ? `Run #: ${run.runNumber}` : '',
        run.runAttempt ? `Attempt: ${run.runAttempt}` : '',
        run.branch ? `Branch: ${run.branch}` : '',
        run.sha ? `Commit: ${run.sha}` : '',
        run.startedAt ? `Started: ${formatDateTime(run.startedAt)}` : run.createdAt ? `Created: ${formatDateTime(run.createdAt)}` : '',
        run.completedAt ? `Completed: ${formatDateTime(run.completedAt)}` : run.updatedAt ? `Updated: ${formatDateTime(run.updatedAt)}` : '',
        duration ? `Duration: ${duration}` : ''
      ]
        .filter(Boolean)
        .join('\n');
      item.contextValue = 'giteaRun';
      if (run.htmlUrl) {
        item.resourceUri = vscode.Uri.parse(run.htmlUrl);
      }
      return item;
    }
    case 'job': {
      const { job } = node;
      const label = job.name;
      const duration = formatDuration(job.startedAt, job.completedAt);
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.id = `job-${node.runId}-${job.id}`;
      item.iconPath = iconForJob(job);
      item.description = duration || undefined;
      item.tooltip = [
        job.name,
        job.startedAt ? `Started: ${formatDateTime(job.startedAt)}` : '',
        job.completedAt ? `Completed: ${formatDateTime(job.completedAt)}` : ''
      ]
        .filter(Boolean)
        .join('\n');
      item.contextValue = 'giteaJob';
      item.command = {
        command: 'giteaActions.viewJobLogs',
        title: 'View Logs',
        arguments: [node]
      };
      if (job.htmlUrl) {
        item.resourceUri = vscode.Uri.parse(job.htmlUrl);
      }
      return item;
    }
    case 'message': {
      const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = node.severity === 'error' ? errorIcon : infoIcon;
      item.contextValue = 'giteaMessage';
      return item;
    }
  }
}
