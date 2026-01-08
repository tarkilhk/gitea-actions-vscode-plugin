import * as vscode from 'vscode';

let verbose = false;
const channel = vscode.window.createOutputChannel('Gitea Actions');

function timestamp(): string {
  return new Date().toISOString();
}

export function setVerboseLogging(enabled: boolean): void {
  verbose = enabled;
}

export function logInfo(message: string): void {
  channel.appendLine(`[INFO ${timestamp()}] ${message}`);
}

export function logWarn(message: string): void {
  channel.appendLine(`[WARN ${timestamp()}] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const suffix = error instanceof Error ? `: ${error.message}` : '';
  channel.appendLine(`[ERROR ${timestamp()}] ${message}${suffix}`);
  if (error instanceof Error && error.stack) {
    channel.appendLine(error.stack);
  }
}

export function logDebug(message: string): void {
  if (verbose) {
    channel.appendLine(`[DEBUG ${timestamp()}] ${message}`);
  }
}

export function getOutputChannel(): vscode.OutputChannel {
  return channel;
}
