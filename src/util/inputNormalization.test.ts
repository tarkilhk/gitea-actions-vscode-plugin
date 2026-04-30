import { describe, expect, it } from 'vitest';
import { normalizeEscapedNewlines } from './inputNormalization';

describe('normalizeEscapedNewlines', () => {
  it('converts escaped newline sequences into real newlines', () => {
    const value = 'line1\\nline2\\nline3';
    expect(normalizeEscapedNewlines(value)).toBe('line1\nline2\nline3');
  });

  it('converts escaped CRLF sequences into a single newline', () => {
    const value = 'line1\\r\\nline2';
    expect(normalizeEscapedNewlines(value)).toBe('line1\nline2');
  });

  it('converts escaped carriage return sequences into newlines', () => {
    const value = 'line1\\rline2';
    expect(normalizeEscapedNewlines(value)).toBe('line1\nline2');
  });

  it('normalizes real CRLF sequences to newlines', () => {
    const value = 'line1\r\nline2';
    expect(normalizeEscapedNewlines(value)).toBe('line1\nline2');
  });

  it('normalizes real CR sequences to newlines', () => {
    const value = 'line1\rline2';
    expect(normalizeEscapedNewlines(value)).toBe('line1\nline2');
  });

  it('keeps ordinary single-line values unchanged', () => {
    const value = 'single-line-value';
    expect(normalizeEscapedNewlines(value)).toBe('single-line-value');
  });
});
