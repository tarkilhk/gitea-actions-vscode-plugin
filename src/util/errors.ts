import * as vscode from 'vscode';
import { logError } from './logging';

/**
 * True when a request was cancelled by AbortController (client timeout).
 * undici/Node surfaces this as AbortError with "This operation was aborted".
 */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = 'name' in error ? String(error.name) : '';
  const message = 'message' in error ? String(error.message) : String(error);
  return name === 'AbortError' || message.includes('This operation was aborted');
}

/**
 * Extracts an error message from an unknown error value.
 */
export function getErrorMessage(error: unknown): string {
  if (isAbortError(error)) {
    return 'The request timed out waiting for Gitea.';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Handles a command error by showing an error message and logging.
 * @param operation - Description of the operation that failed (e.g., "create secret")
 * @param error - The error that occurred
 */
export function handleCommandError(operation: string, error: unknown): void {
  const message = getErrorMessage(error);
  vscode.window.showErrorMessage(`Failed to ${operation}: ${message}`);
  logError(`Failed to ${operation}`, error);
}

/**
 * Handles an error by showing a warning message (for non-critical failures).
 * @param operation - Description of the operation that failed
 * @param error - The error that occurred
 */
export function handleWarning(operation: string, error: unknown): void {
  const message = getErrorMessage(error);
  vscode.window.showWarningMessage(`${operation}: ${message}`);
}

/**
 * Wraps an async operation with error handling.
 * @param operation - Description of the operation
 * @param fn - The async function to execute
 * @returns The result of the operation, or undefined if it failed
 */
export async function withErrorHandling<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    handleCommandError(operation, error);
    return undefined;
  }
}
