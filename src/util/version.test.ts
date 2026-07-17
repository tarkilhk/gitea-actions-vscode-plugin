import { describe, it, expect } from 'vitest';
import { parseVersion, isVersionAtLeast, supportsPerWorkflowRuns } from './version';

describe('parseVersion', () => {
  it('parses plain versions', () => {
    expect(parseVersion('1.27.0')).toEqual({ major: 1, minor: 27, patch: 0 });
    expect(parseVersion('1.26.4')).toEqual({ major: 1, minor: 26, patch: 4 });
  });

  it('parses versions with suffixes', () => {
    expect(parseVersion('1.27.0+dev-123-gabcdef')).toEqual({ major: 1, minor: 27, patch: 0 });
    expect(parseVersion('1.28.0-rc1')).toEqual({ major: 1, minor: 28, patch: 0 });
  });

  it('parses versions with v prefix', () => {
    expect(parseVersion('v1.27.1')).toEqual({ major: 1, minor: 27, patch: 1 });
  });

  it('parses versions without patch', () => {
    expect(parseVersion('1.27')).toEqual({ major: 1, minor: 27, patch: 0 });
  });

  it('returns undefined for unparseable input', () => {
    expect(parseVersion('unknown')).toBeUndefined();
    expect(parseVersion('')).toBeUndefined();
    expect(parseVersion(null)).toBeUndefined();
    expect(parseVersion(undefined)).toBeUndefined();
  });
});

describe('isVersionAtLeast', () => {
  it('returns true for equal and newer versions', () => {
    expect(isVersionAtLeast('1.27.0', 1, 27)).toBe(true);
    expect(isVersionAtLeast('1.27.5', 1, 27)).toBe(true);
    expect(isVersionAtLeast('1.28.0', 1, 27)).toBe(true);
    expect(isVersionAtLeast('2.0.0', 1, 27)).toBe(true);
  });

  it('returns false for older versions', () => {
    expect(isVersionAtLeast('1.26.4', 1, 27)).toBe(false);
    expect(isVersionAtLeast('1.24.0', 1, 27)).toBe(false);
    expect(isVersionAtLeast('0.9.0', 1, 27)).toBe(false);
  });

  it('returns false for unknown versions', () => {
    expect(isVersionAtLeast('unknown', 1, 27)).toBe(false);
    expect(isVersionAtLeast(undefined, 1, 27)).toBe(false);
    expect(isVersionAtLeast(null, 1, 27)).toBe(false);
  });
});

describe('supportsPerWorkflowRuns', () => {
  it('is enabled from 1.27.0 onwards', () => {
    expect(supportsPerWorkflowRuns('1.27.0')).toBe(true);
    expect(supportsPerWorkflowRuns('1.27.0+dev-abc')).toBe(true);
    expect(supportsPerWorkflowRuns('1.28.0')).toBe(true);
  });

  it('is disabled for older or unknown versions', () => {
    expect(supportsPerWorkflowRuns('1.26.4')).toBe(false);
    expect(supportsPerWorkflowRuns(undefined)).toBe(false);
  });
});
