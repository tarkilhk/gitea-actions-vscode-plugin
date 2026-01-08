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
      const labelParts = [run.name];
      if (run.branch) {
        labelParts.push(run.branch);
      }
      if (run.sha) {
        labelParts.push(shortSha(run.sha));
      }
      const item = new vscode.TreeItem(labelParts.join(' · '), vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = iconForRun(run);
      const updated = formatAgo(run.updatedAt ?? run.createdAt);
      item.description = updated;
      item.tooltip = [
        run.name,
        run.branch ? `Branch: ${run.branch}` : '',
        run.sha ? `Commit: ${run.sha}` : '',
        run.createdAt ? `Created: ${formatDateTime(run.createdAt)}` : '',
        run.updatedAt ? `Updated: ${formatDateTime(run.updatedAt)}` : ''
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
