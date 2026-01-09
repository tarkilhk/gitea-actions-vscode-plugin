import * as vscode from 'vscode';
import { WorkflowRun } from '../gitea/models';
import { TOAST_TIMEOUT_MS } from '../config/constants';
import { normalizeStatus } from '../util/status';

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Initializes the status bar item.
 */
export function initStatusBar(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'workbench.view.extension.giteaActions';
  statusBarItem.text = 'Gitea: idle';
  statusBarItem.show();
  return statusBarItem;
}

/**
 * Gets the current status bar item.
 */
export function getStatusBarItem(): vscode.StatusBarItem | undefined {
  return statusBarItem;
}

/**
 * Updates the status bar with the given text or computes it from run data.
 */
export function updateStatusBar(
  text?: string,
  lastRunsByRepo?: Map<string, WorkflowRun[]>
): void {
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
}

/**
 * Checks if a status indicates a running/active state.
 */
export function isRunning(status?: string): boolean {
  const normalized = normalizeStatus(status);
  return normalized === 'running' || normalized === 'queued';
}

/**
 * Shows a toast notification that auto-dismisses after a few seconds.
 * Uses VS Code's progress notification for info messages (auto-dismisses).
 * Warnings and errors use standard message dialogs that require dismissal.
 */
export function showToast(
  message: string,
  type: 'info' | 'warning' | 'error' = 'info',
  timeoutMs: number = TOAST_TIMEOUT_MS
): void {
  if (type === 'warning') {
    void vscode.window.showWarningMessage(message);
  } else if (type === 'error') {
    void vscode.window.showErrorMessage(message);
  } else {
    // Use progress notification for info messages - auto-dismisses after timeout
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
