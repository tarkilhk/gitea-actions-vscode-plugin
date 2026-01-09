import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatDuration, formatAgo, formatDateTime } from './time';

describe('formatDuration', () => {
  it('returns empty string when start is undefined', () => {
    expect(formatDuration(undefined, '2024-01-01T12:00:00Z')).toBe('');
  });

  it('formats seconds correctly', () => {
    const start = '2024-01-01T12:00:00Z';
    const end = '2024-01-01T12:00:30Z';
    expect(formatDuration(start, end)).toBe('30s');
  });

  it('formats minutes and seconds correctly', () => {
    const start = '2024-01-01T12:00:00Z';
    const end = '2024-01-01T12:05:30Z';
    expect(formatDuration(start, end)).toBe('5m 30s');
  });

  it('formats hours and minutes correctly', () => {
    const start = '2024-01-01T12:00:00Z';
    const end = '2024-01-01T14:30:00Z';
    expect(formatDuration(start, end)).toBe('2h 30m');
  });

  it('uses current time when end is undefined', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 60000).toISOString(); // 1 minute ago
    const result = formatDuration(start);
    expect(result).toBe('1m 0s');
  });

  it('returns empty string for negative duration', () => {
    const start = '2024-01-01T12:00:00Z';
    const end = '2024-01-01T11:00:00Z';
    expect(formatDuration(start, end)).toBe('');
  });

  it('returns empty string for invalid dates', () => {
    expect(formatDuration('invalid', '2024-01-01T12:00:00Z')).toBe('');
  });
});

describe('formatAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string when date is undefined', () => {
    expect(formatAgo(undefined)).toBe('');
  });

  it('formats seconds ago', () => {
    const date = '2024-01-01T11:59:30Z'; // 30 seconds ago
    expect(formatAgo(date)).toBe('30s ago');
  });

  it('formats minutes ago', () => {
    const date = '2024-01-01T11:55:00Z'; // 5 minutes ago
    expect(formatAgo(date)).toBe('5m ago');
  });

  it('formats hours ago', () => {
    const date = '2024-01-01T09:00:00Z'; // 3 hours ago
    expect(formatAgo(date)).toBe('3h ago');
  });

  it('formats days ago', () => {
    const date = '2023-12-29T12:00:00Z'; // 3 days ago
    expect(formatAgo(date)).toBe('3d ago');
  });

  it('returns empty string for invalid dates', () => {
    expect(formatAgo('invalid')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('returns empty string when date is undefined', () => {
    expect(formatDateTime(undefined)).toBe('');
  });

  it('returns empty string for invalid dates', () => {
    expect(formatDateTime('invalid')).toBe('');
  });

  it('formats valid date correctly', () => {
    const date = '2024-01-01T12:00:00Z';
    const result = formatDateTime(date);
    // The exact format depends on locale, but it should not be empty
    expect(result).not.toBe('');
    expect(result.length).toBeGreaterThan(0);
  });
});
