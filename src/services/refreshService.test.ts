import { describe, it, expect, vi } from 'vitest';
import {
  RefreshServiceState,
  getActiveRunsForRefresh,
  hasRepoListChanged,
  limitRunsPerWorkflow,
  mergeRuns,
  resetRefreshCaches
} from './refreshService';
import { WorkflowRun } from '../gitea/models';

describe('hasRepoListChanged', () => {
  it('should return true when oldKeys is undefined (first load)', () => {
    const newKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    expect(hasRepoListChanged(undefined, newKeys)).toBe(true);
  });

  it('should return false when both sets are empty', () => {
    const oldKeys = new Set<string>();
    const newKeys = new Set<string>();
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(false);
  });

  it('should return false when sets are identical', () => {
    const oldKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    const newKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(false);
  });

  it('should return false when sets have same keys in different order', () => {
    const oldKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    const newKeys = new Set(['owner2/repo2', 'owner1/repo1']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(false);
  });

  it('should return true when a repo is added', () => {
    const oldKeys = new Set(['owner1/repo1']);
    const newKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(true);
  });

  it('should return true when a repo is removed', () => {
    const oldKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    const newKeys = new Set(['owner1/repo1']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(true);
  });

  it('should return true when a repo is replaced', () => {
    const oldKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    const newKeys = new Set(['owner1/repo1', 'owner3/repo3']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(true);
  });

  it('should return true when all repos change', () => {
    const oldKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    const newKeys = new Set(['owner3/repo3', 'owner4/repo4']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(true);
  });
});

describe('mergeRuns', () => {
  const makeRun = (id: number | string, updatedAt?: string): WorkflowRun => ({
    id,
    name: `run-${id}`,
    status: 'completed',
    conclusion: 'success',
    updatedAt
  });

  it('merges and deduplicates by run id', () => {
    const primary = [makeRun(1, '2026-07-01T00:00:00Z'), makeRun(2, '2026-06-01T00:00:00Z')];
    const extra = [makeRun(2, '2026-06-01T00:00:00Z'), makeRun(3, '2026-05-01T00:00:00Z')];
    const merged = mergeRuns(primary, extra);
    expect(merged.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('prefers the primary version of a duplicated run', () => {
    const primaryRun = makeRun(1, '2026-07-01T00:00:00Z');
    const staleRun = { ...makeRun(1, '2026-07-01T00:00:00Z'), name: 'stale' };
    const merged = mergeRuns([primaryRun], [staleRun]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('run-1');
  });

  it('sorts merged runs by most recent activity descending', () => {
    const primary = [makeRun(1, '2026-01-01T00:00:00Z')];
    const extra = [makeRun(2, '2026-03-01T00:00:00Z'), makeRun(3, '2026-02-01T00:00:00Z')];
    const merged = mergeRuns(primary, extra);
    expect(merged.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('deduplicates numeric and string ids that are equal', () => {
    const merged = mergeRuns([makeRun(5)], [makeRun('5')]);
    expect(merged).toHaveLength(1);
  });

  it('handles empty inputs', () => {
    expect(mergeRuns([], [])).toEqual([]);
    expect(mergeRuns([makeRun(1)], []).map((r) => r.id)).toEqual([1]);
    expect(mergeRuns([], [makeRun(1)]).map((r) => r.id)).toEqual([1]);
  });

  it('keeps per-workflow-only active runs on the active refresh cadence', () => {
    const primary = [makeRun(1, '2026-07-01T00:00:00Z')];
    const perWorkflowRun = {
      ...makeRun(2, '2026-06-01T00:00:00Z'),
      status: 'running' as const,
      conclusion: undefined
    };
    const activeRuns = getActiveRunsForRefresh(mergeRuns(primary, [perWorkflowRun]));
    expect(activeRuns.map((run) => run.id)).toEqual([2]);
  });
});

describe('limitRunsPerWorkflow', () => {
  const makeRun = (
    id: number,
    workflowPath: string,
    updatedAt: string
  ): WorkflowRun => ({
    id,
    name: `run-${id}`,
    status: 'completed',
    conclusion: 'success',
    workflowPath,
    updatedAt
  });

  it('caps each workflow independently while preserving sort order', () => {
    const runs = [
      makeRun(1, '.gitea/workflows/busy.yml', '2026-07-05T00:00:00Z'),
      makeRun(2, '.gitea/workflows/busy.yml', '2026-07-04T00:00:00Z'),
      makeRun(3, '.gitea/workflows/quiet.yml', '2026-07-03T00:00:00Z'),
      makeRun(4, '.gitea/workflows/busy.yml', '2026-07-02T00:00:00Z'),
      makeRun(5, '.gitea/workflows/quiet.yml', '2026-07-01T00:00:00Z'),
      makeRun(6, '.gitea/workflows/busy.yml', '2026-06-30T00:00:00Z')
    ];
    const limited = limitRunsPerWorkflow(runs, 2);
    expect(limited.map((r) => r.id)).toEqual([1, 2, 3, 5]);
  });

  it('does not drop quiet-workflow runs that sit after a busy workflow in the list', () => {
    // Simulates mergeRuns(baseRuns, perWorkflow): busy workflow fills the
    // repo-wide list, then quieter workflow runs are appended from the
    // per-workflow fetch.
    const baseRuns = Array.from({ length: 10 }, (_, i) =>
      makeRun(100 - i, '.gitea/workflows/busy.yml', `2026-07-${String(20 - i).padStart(2, '0')}T00:00:00Z`)
    );
    const quietRuns = [
      makeRun(1, '.gitea/workflows/quiet.yml', '2026-06-02T00:00:00Z'),
      makeRun(2, '.gitea/workflows/quiet.yml', '2026-06-01T00:00:00Z')
    ];
    const limited = limitRunsPerWorkflow(mergeRuns(baseRuns, quietRuns), 5);
    expect(limited.filter((r) => r.workflowPath?.includes('busy')).map((r) => r.id)).toEqual([
      100, 99, 98, 97, 96
    ]);
    expect(limited.filter((r) => r.workflowPath?.includes('quiet')).map((r) => r.id)).toEqual([1, 2]);
  });

  it('returns the input unchanged when limit is 0', () => {
    const runs = [makeRun(1, '.gitea/workflows/ci.yml', '2026-07-01T00:00:00Z')];
    expect(limitRunsPerWorkflow(runs, 0)).toBe(runs);
  });
});

describe('resetRefreshCaches', () => {
  function makeState(): RefreshServiceState {
    return {
      jobRefreshTimers: new Map(),
      inFlightJobFetch: new Map(),
      jobStepsCache: new Map(),
      workflowNameCache: new Map(),
      workspaceProvider: { resetJobCaches: vi.fn() },
      workflowsProvider: { resetJobCaches: vi.fn() },
      lastRepoKeys: new Set(['owner/repo']),
      serverVersionCache: { value: '1.27.0' }
    } as unknown as RefreshServiceState;
  }

  it('preserves the session version during an ordinary cache reset', () => {
    const state = makeState();
    resetRefreshCaches(state);
    expect(state.serverVersionCache.value).toBe('1.27.0');
  });

  it('invalidates the session version when the configured server changes', () => {
    const state = makeState();
    resetRefreshCaches(state, { resetServerVersion: true });
    expect(state.serverVersionCache.value).toBeUndefined();
  });
});
