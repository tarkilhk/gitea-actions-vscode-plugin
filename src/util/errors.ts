import * as vscode from 'vscode';
import { logError } from './logging';

/**
 * Extracts an error message from an unknown error value.
 */
export function getErrorMessage(error: unknown): string {
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
