import { describe, it, expect } from 'vitest';
import {
  normalizeStatus,
  normalizeConclusion,
  statusIcon
} from './status';

describe('normalizeStatus', () => {
  it('returns "queued" for queued status', () => {
    expect(normalizeStatus('queued')).toBe('queued');
    expect(normalizeStatus('Queued')).toBe('queued');
    expect(normalizeStatus('QUEUED')).toBe('queued');
  });

  it('returns "queued" for waiting status', () => {
    expect(normalizeStatus('waiting')).toBe('queued');
    expect(normalizeStatus('Waiting')).toBe('queued');
  });

  it('returns "running" for running status', () => {
    expect(normalizeStatus('running')).toBe('running');
    expect(normalizeStatus('Running')).toBe('running');
    expect(normalizeStatus('RUNNING')).toBe('running');
  });

  it('returns "running" for in_progress status', () => {
    expect(normalizeStatus('in_progress')).toBe('running');
    expect(normalizeStatus('In_Progress')).toBe('running');
  });

  it('returns "running" for progress status', () => {
    expect(normalizeStatus('progress')).toBe('running');
  });

  it('returns "completed" for completed status', () => {
    expect(normalizeStatus('completed')).toBe('completed');
    expect(normalizeStatus('Completed')).toBe('completed');
  });

  it('returns "completed" for finished status', () => {
    expect(normalizeStatus('finished')).toBe('completed');
  });

  it('returns "unknown" for unrecognized status', () => {
    expect(normalizeStatus('foo')).toBe('unknown');
    expect(normalizeStatus('bar')).toBe('unknown');
  });

  it('returns "unknown" for null/undefined', () => {
    expect(normalizeStatus(null)).toBe('unknown');
    expect(normalizeStatus(undefined)).toBe('unknown');
  });
});

describe('normalizeConclusion', () => {
  it('returns undefined for empty/null/undefined', () => {
    expect(normalizeConclusion('')).toBeUndefined();
    expect(normalizeConclusion(null)).toBeUndefined();
    expect(normalizeConclusion(undefined)).toBeUndefined();
  });

  it('returns "success" for success-like conclusions', () => {
    expect(normalizeConclusion('success')).toBe('success');
    expect(normalizeConclusion('Success')).toBe('success');
    expect(normalizeConclusion('passed')).toBe('success');
    expect(normalizeConclusion('ok')).toBe('success');
  });

  it('returns "failure" for failure-like conclusions', () => {
    expect(normalizeConclusion('failure')).toBe('failure');
    expect(normalizeConclusion('Failure')).toBe('failure');
    expect(normalizeConclusion('failed')).toBe('failure');
    expect(normalizeConclusion('error')).toBe('failure');
  });

  it('returns "cancelled" for cancelled-like conclusions', () => {
    expect(normalizeConclusion('cancelled')).toBe('cancelled');
    expect(normalizeConclusion('canceled')).toBe('cancelled');
    expect(normalizeConclusion('stopped')).toBe('cancelled');
  });

  it('returns "skipped" for skipped-like conclusions', () => {
    expect(normalizeConclusion('skipped')).toBe('skipped');
    expect(normalizeConclusion('skip')).toBe('skipped');
  });

  it('returns "unknown" for unrecognized conclusions', () => {
    expect(normalizeConclusion('foo')).toBe('unknown');
    expect(normalizeConclusion('bar')).toBe('unknown');
  });
});

describe('statusIcon', () => {
  it('returns queued icon for queued status', () => {
    const icon = statusIcon({ status: 'queued' });
    expect(icon.id).toBe('history');
    expect(icon.color).toBe('charts.blue');
  });

  it('returns running icon for running status', () => {
    const icon = statusIcon({ status: 'running' });
    expect(icon.id).toBe('loading~spin');
    expect(icon.color).toBe('charts.yellow');
  });

  it('returns success icon for success conclusion', () => {
    const icon = statusIcon({ status: 'completed', conclusion: 'success' });
    expect(icon.id).toBe('check');
    expect(icon.color).toBe('charts.green');
  });

  it('returns failure icon for failure conclusion', () => {
    const icon = statusIcon({ status: 'completed', conclusion: 'failure' });
    expect(icon.id).toBe('error');
    expect(icon.color).toBe('charts.red');
  });

  it('returns cancelled icon for cancelled conclusion', () => {
    const icon = statusIcon({ status: 'completed', conclusion: 'cancelled' });
    expect(icon.id).toBe('circle-slash');
    expect(icon.color).toBe('descriptionForeground');
  });

  it('returns skipped icon for skipped conclusion', () => {
    const icon = statusIcon({ status: 'completed', conclusion: 'skipped' });
    expect(icon.id).toBe('debug-step-over');
    expect(icon.color).toBe('descriptionForeground');
  });

  it('returns unknown icon for unknown conclusion', () => {
    const icon = statusIcon({ status: 'completed', conclusion: 'unknown' });
    expect(icon.id).toBe('question');
    expect(icon.color).toBe('descriptionForeground');
  });

  it('prioritizes status over conclusion', () => {
    // Even with a success conclusion, if still running, show running icon
    const icon = statusIcon({ status: 'running', conclusion: 'success' });
    expect(icon.id).toBe('loading~spin');
    expect(icon.color).toBe('charts.yellow');
  });
});
