import { describe, expect, it } from 'vitest';
import { getErrorMessage, isAbortError } from './errors';

describe('isAbortError', () => {
  it('detects AbortError by name', () => {
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('detects the undici abort message without AbortError name', () => {
    expect(isAbortError(new Error('This operation was aborted'))).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isAbortError(new Error('Request failed (404): not found'))).toBe(false);
    expect(isAbortError('nope')).toBe(false);
  });
});

describe('getErrorMessage', () => {
  it('maps abort errors to a timeout message', () => {
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    expect(getErrorMessage(error)).toBe('The request timed out waiting for Gitea.');
  });

  it('keeps other error messages', () => {
    expect(getErrorMessage(new Error('Request failed (500)'))).toBe('Request failed (500)');
  });
});
