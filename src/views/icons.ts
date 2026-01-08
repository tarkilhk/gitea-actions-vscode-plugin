import * as vscode from 'vscode';
import { WorkflowRun, Job } from '../gitea/models';
import { statusIconForJob, statusIconForRun } from '../util/status';

function themeIconFromToken(token: string): vscode.ThemeIcon {
  const match = token.match(/^\$\((.+)\)$/);
  return new vscode.ThemeIcon(match ? match[1] : token);
}

export function iconForRun(run: WorkflowRun): vscode.ThemeIcon {
  return themeIconFromToken(statusIconForRun(run));
}

export function iconForJob(job: Job): vscode.ThemeIcon {
  return themeIconFromToken(statusIconForJob(job));
}

export const repoIcon = new vscode.ThemeIcon('repo');
export const errorIcon = new vscode.ThemeIcon('alert');
export const infoIcon = new vscode.ThemeIcon('info');
