import * as vscode from 'vscode';
import { Job, RepoRef, RunRef, WorkflowRun, Step, toRunRef } from '../gitea/models';
import {
  iconForJob,
  iconForRun,
  iconForStep,
  repoIcon,
  errorIcon,
  infoIcon,
  secretIcon,
  variableIcon,
  settingsIcon
} from './icons';
import { formatAgo, formatDateTime, formatDuration } from '../util/time';

export type RunNode = {
  type: 'run';
  repo: RepoRef;
  run: WorkflowRun;
};

export type WorkflowGroupNode = {
  type: 'workflowGroup';
  name: string;
  runs: WorkflowRun[];
  repo: RepoRef;
};

export type JobNode = {
  type: 'job';
  /** Reference to the workflow run (contains repo, id, and runNumber) */
  runRef: RunRef;
  job: Job;
  /** 0-based job index within the run, used by internal API */
  jobIndex: number;
};

export type StepNode = {
  type: 'step';
  /** Reference to the workflow run (contains repo, id, and runNumber) */
  runRef: RunRef;
  job: Job;
  step: Step;
  /** 0-based job index within the run, used by internal API */
  jobIndex: number;
  /** 0-based step index within the job, used by internal API */
  stepIndex: number;
};

/**
 * Helper to create a RunRef from a RunNode.
 */
export function runNodeToRef(node: RunNode): RunRef {
  return toRunRef(node.repo, node.run);
}

export type MessageNode = {
  type: 'message';
  repo?: RepoRef;
  message: string;
  severity: 'info' | 'error';
  action?: 'configureBaseUrl' | 'setToken';
};

export type RepoNode = {
  type: 'repo';
  repo: RepoRef;
  expanded?: boolean;
};

export type SecretsRootNode = {
  type: 'secretsRoot';
  repo: RepoRef;
};

export type SecretNode = {
  type: 'secret';
  repo: RepoRef;
  name: string;
  description?: string;
  createdAt?: string;
};

export type VariablesRootNode = {
  type: 'variablesRoot';
  repo: RepoRef;
};

export type VariableNode = {
  type: 'variable';
  repo: RepoRef;
  name: string;
  description?: string;
  value?: string;
};

export type ConfigRootNode = {
  type: 'configRoot';
  repo?: RepoRef;
};

export type TokenNode = {
  type: 'token';
  hasToken: boolean;
};

export type ConfigActionNode = {
  type: 'configAction';
  action: 'testConnection' | 'openSettings';
};

export type ActionsNode =
  | RunNode
  | WorkflowGroupNode
  | JobNode
  | StepNode
  | MessageNode
  | RepoNode
  | SecretsRootNode
  | SecretNode
  | VariablesRootNode
  | VariableNode
  | ConfigRootNode
  | TokenNode
  | ConfigActionNode;

function buildRunLabel(run: WorkflowRun): string {
  const base = run.workflowName ?? run.displayTitle ?? run.name;
  const idPart = run.runNumber ?? run.id;
  return `${base} #${idPart}`;
}

function buildRunTooltip(run: WorkflowRun): string {
  const duration = formatDuration(run.startedAt ?? run.createdAt, run.completedAt ?? run.updatedAt);
  const status = run.conclusion ?? run.status;
  const statusLabel = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Status';
  const when = formatAgo(run.completedAt ?? run.updatedAt ?? run.createdAt);
  const absolute = formatDateTime(run.completedAt ?? run.updatedAt ?? run.createdAt);
  const actor = run.actor ?? 'unknown';
  const event = run.event ?? 'workflow';
  const commitMsg = run.commitMessage ?? '';
  return [
    `${statusLabel}${duration ? ` in ${duration}` : ''}`,
    `Triggered via ${event} by ${actor} ${when}${absolute ? ` (${absolute})` : ''}`,
    commitMsg ? `Commit: ${commitMsg}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function toTreeItem(node: ActionsNode): vscode.TreeItem {
  switch (node.type) {
    case 'workflowGroup': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `workflow-group-${node.repo.owner}-${node.repo.name}-${node.name}`;
      item.contextValue = 'giteaWorkflowGroup';
      item.iconPath = repoIcon;
      item.description = `${node.runs.length} run${node.runs.length === 1 ? '' : 's'}`;
      return item;
    }
    case 'run': {
      const { run, repo } = node;
      const label = buildRunLabel(run);
      const duration = formatDuration(run.startedAt ?? run.createdAt, run.completedAt ?? run.updatedAt);
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `run-${repo.owner}-${repo.name}-${run.id}`;
      item.iconPath = iconForRun(run);
      item.description = duration || undefined;
      item.tooltip = buildRunTooltip(run);
      item.contextValue = 'giteaRun';
      if (run.htmlUrl) {
        item.resourceUri = vscode.Uri.parse(run.htmlUrl);
      }
      return item;
    }
    case 'job': {
      const { job, runRef } = node;
      const label = job.name;
      const duration = formatDuration(job.startedAt, job.completedAt);
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `job-${runRef.repo.owner}-${runRef.repo.name}-${runRef.id}-${job.id}`;
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
    case 'step': {
      const { step, job, runRef } = node;
      // Use duration from internal API if available, otherwise calculate from timestamps
      const duration = step.duration || formatDuration(step.startedAt, step.completedAt);
      const label = step.name || 'Step';
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.id = `step-${runRef.repo.owner}-${runRef.repo.name}-${runRef.id}-${job.id}-${step.stepIndex ?? step.id ?? step.number ?? step.name}`;
      item.iconPath = iconForStep(step);
      item.description = duration || undefined;
      item.tooltip = [
        step.name,
        step.startedAt ? `Started: ${formatDateTime(step.startedAt)}` : '',
        step.completedAt ? `Completed: ${formatDateTime(step.completedAt)}` : ''
      ]
        .filter(Boolean)
        .join('\n');
      item.contextValue = 'giteaStep';
      item.command = {
        command: 'giteaActions.viewJobLogs',
        title: 'View Logs',
        arguments: [node]
      };
      return item;
    }
    case 'message': {
      const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = node.severity === 'error' ? errorIcon : infoIcon;
      item.contextValue = 'giteaMessage';
      if (node.action === 'configureBaseUrl') {
        item.command = {
          command: 'giteaActions.openBaseUrlSettings',
          title: 'Configure base URL',
          arguments: []
        };
      } else if (node.action === 'setToken') {
        item.command = {
          command: 'giteaActions.setToken',
          title: 'Set token',
          arguments: []
        };
      }
      return item;
    }
    case 'repo': {
      const collapsibleState = node.expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      const item = new vscode.TreeItem(`${node.repo.owner}/${node.repo.name}`, collapsibleState);
      item.id = `repo-${node.repo.owner}-${node.repo.name}`;
      item.iconPath = repoIcon;
      item.contextValue = 'giteaRepo';
      return item;
    }
    case 'configRoot': {
      const item = new vscode.TreeItem('Gitea Actions Config', vscode.TreeItemCollapsibleState.Collapsed);
      item.id = node.repo ? `config-root-${node.repo.owner}-${node.repo.name}` : 'config-root';
      item.iconPath = settingsIcon;
      item.contextValue = 'giteaConfigRoot';
      return item;
    }
    case 'token': {
      const item = new vscode.TreeItem('Token', vscode.TreeItemCollapsibleState.None);
      item.id = 'token-status';
      item.iconPath = new vscode.ThemeIcon('key');
      item.description = node.hasToken ? '✓' : '✗';
      item.contextValue = 'giteaToken';
      return item;
    }
    case 'configAction': {
      if (node.action === 'testConnection') {
        const item = new vscode.TreeItem('Test Connection', vscode.TreeItemCollapsibleState.None);
        item.id = `config-action-${node.action}`;
        item.iconPath = new vscode.ThemeIcon('sync');
        item.contextValue = 'giteaConfigAction';
        item.command = {
          command: 'giteaActions.testConnection',
          title: 'Test Connection'
        };
        return item;
      } else if (node.action === 'openSettings') {
        const item = new vscode.TreeItem('Open Settings', vscode.TreeItemCollapsibleState.None);
        item.id = `config-action-${node.action}`;
        item.iconPath = settingsIcon;
        item.contextValue = 'giteaConfigAction';
        item.command = {
          command: 'giteaActions.openSettings',
          title: 'Open Settings'
        };
        return item;
      }
      // Fallback (should not happen)
      const item = new vscode.TreeItem('Unknown Action', vscode.TreeItemCollapsibleState.None);
      item.id = `config-action-${node.action}`;
      return item;
    }
    case 'secretsRoot': {
      const item = new vscode.TreeItem('Secrets', vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `secrets-root-${node.repo.owner}-${node.repo.name}`;
      item.iconPath = secretIcon;
      item.contextValue = 'giteaSecretsRoot';
      return item;
    }
    case 'secret': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      item.id = `secret-${node.repo.owner}-${node.repo.name}-${node.name}`;
      item.iconPath = secretIcon;
      item.description = node.description || undefined;
      item.contextValue = 'giteaSecret';
      item.tooltip = node.description ? `${node.name}\n${node.description}` : node.name;
      return item;
    }
    case 'variablesRoot': {
      const item = new vscode.TreeItem('Variables', vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `variables-root-${node.repo.owner}-${node.repo.name}`;
      item.iconPath = variableIcon;
      item.contextValue = 'giteaVariablesRoot';
      return item;
    }
    case 'variable': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      item.id = `variable-${node.repo.owner}-${node.repo.name}-${node.name}`;
      item.iconPath = variableIcon;
      item.description = node.description || undefined;
      item.contextValue = 'giteaVariable';
      const tooltipParts = [node.name];
      if (node.description) tooltipParts.push(node.description);
      if (node.value) tooltipParts.push(`Value: ${node.value}`);
      item.tooltip = tooltipParts.join('\n');
      return item;
    }
  }
}
