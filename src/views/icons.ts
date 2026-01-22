import * as vscode from 'vscode';
import { WorkflowRun, Job, Step } from '../gitea/models';
import { statusIcon, StatusIcon, HasStatusConclusion } from '../util/status';

type IconToken = string | StatusIcon;

function themeIconFromToken(token: IconToken): vscode.ThemeIcon {
  if (typeof token === 'string') {
    const match = token.match(/^\$\((.+)\)$/);
    return new vscode.ThemeIcon(match ? match[1] : token);
  }
  const color = token.color ? new vscode.ThemeColor(token.color) : undefined;
  return new vscode.ThemeIcon(token.id, color);
}

/**
 * Creates a ThemeIcon for any item with status/conclusion (Run, Job, Step).
 */
function iconForStatusItem(item: HasStatusConclusion): vscode.ThemeIcon {
  return themeIconFromToken(statusIcon(item));
}

export function iconForRun(run: WorkflowRun): vscode.ThemeIcon {
  return iconForStatusItem(run);
}

export function iconForJob(job: Job): vscode.ThemeIcon {
  return iconForStatusItem(job);
}

export function iconForStep(step: Step): vscode.ThemeIcon {
  return iconForStatusItem(step);
}

export const repoIcon = new vscode.ThemeIcon('repo');
export const errorIcon = new vscode.ThemeIcon('alert');
export const infoIcon = new vscode.ThemeIcon('info');
export const secretIcon = new vscode.ThemeIcon('lock');
export const variableIcon = new vscode.ThemeIcon('symbol-variable', new vscode.ThemeColor('foreground'));
export const settingsIcon = new vscode.ThemeIcon('settings-gear');
export const folderIcon = new vscode.ThemeIcon('folder');
