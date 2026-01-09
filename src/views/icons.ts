import * as vscode from 'vscode';
import { WorkflowRun, Job, Step } from '../gitea/models';
import { statusIconForJob, statusIconForRun, statusIconForStep, StatusIcon } from '../util/status';

type IconToken = string | StatusIcon;

function themeIconFromToken(token: IconToken): vscode.ThemeIcon {
  if (typeof token === 'string') {
    const match = token.match(/^\$\((.+)\)$/);
    return new vscode.ThemeIcon(match ? match[1] : token);
  }
  const color = token.color ? new vscode.ThemeColor(token.color) : undefined;
  return new vscode.ThemeIcon(token.id, color);
}

export function iconForRun(run: WorkflowRun): vscode.ThemeIcon {
  return themeIconFromToken(statusIconForRun(run));
}

export function iconForJob(job: Job): vscode.ThemeIcon {
  return themeIconFromToken(statusIconForJob(job));
}

export function iconForStep(step: Step): vscode.ThemeIcon {
  return themeIconFromToken(statusIconForStep(step));
}

export const repoIcon = new vscode.ThemeIcon('repo');
export const errorIcon = new vscode.ThemeIcon('alert');
export const infoIcon = new vscode.ThemeIcon('info');
