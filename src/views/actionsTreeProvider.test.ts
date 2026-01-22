import { describe, it, expect, beforeEach } from 'vitest';
import { ActionsTreeProvider } from './actionsTreeProvider';
import { RepoRef, WorkflowRun, Job } from '../gitea/models';
import { ActionsNode, RepoNode, RunNode, JobNode } from './nodes';

describe('ActionsTreeProvider - Expansion State Preservation', () => {
  let provider: ActionsTreeProvider;
  const testRepo: RepoRef = {
    host: 'gitea.example.com',
    owner: 'test',
    name: 'test-repo'
  };

  const createTestRun = (id: number | string, name: string): WorkflowRun => ({
    id,
    name,
    status: 'completed',
    conclusion: 'success',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z'
  });

  const createTestJob = (id: number | string, name: string): Job => ({
    id,
    name,
    status: 'completed',
    conclusion: 'success',
    startedAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:00:00Z'
  });

  beforeEach(() => {
    provider = new ActionsTreeProvider('runs');
  });

  describe('markExpanded and markCollapsed', () => {
    it('should track expanded repo nodes', () => {
      const repoNode: RepoNode = {
        type: 'repo',
        repo: testRepo
      };

      provider.markExpanded(repoNode);
      const expandedIds = provider.getExpandedNodeIds();
      expect(expandedIds.has('repo-test-test-repo')).toBe(true);
    });

    it('should track expanded run nodes', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow');
      provider.updateRuns(testRepo, [run]);

      const runNode: RunNode = {
        type: 'run',
        repo: testRepo,
        run
      };

      provider.markExpanded(runNode);
      const expandedIds = provider.getExpandedNodeIds();
      expect(expandedIds.has('run-test-test-repo-123')).toBe(true);
    });

    it('should track expanded job nodes', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow');
      provider.updateRuns(testRepo, [run]);
      const job = createTestJob(456, 'test-job');
      provider.updateJobs(testRepo, 123, [job]);

      const jobNode: JobNode = {
        type: 'job',
        runRef: { repo: testRepo, id: 123 },
        job,
        jobIndex: 0
      };

      provider.markExpanded(jobNode);
      const expandedIds = provider.getExpandedNodeIds();
      expect(expandedIds.has('job-test-test-repo-123-456')).toBe(true);
    });

    it('should remove collapsed nodes from tracking', () => {
      const repoNode: RepoNode = {
        type: 'repo',
        repo: testRepo
      };

      provider.markExpanded(repoNode);
      expect(provider.getExpandedNodeIds().has('repo-test-test-repo')).toBe(true);

      provider.markCollapsed(repoNode);
      expect(provider.getExpandedNodeIds().has('repo-test-test-repo')).toBe(false);
    });

    it('should handle nodes without IDs gracefully', () => {
      const messageNode = {
        type: 'message' as const,
        message: 'test',
        severity: 'info' as const
      };

      // Should not throw
      provider.markExpanded(messageNode);
      provider.markCollapsed(messageNode);
    });
  });

  describe('getExpandedNodeIds', () => {
    it('should return a copy of expanded node IDs', () => {
      const repoNode: RepoNode = {
        type: 'repo',
        repo: testRepo
      };

      provider.markExpanded(repoNode);
      const expandedIds1 = provider.getExpandedNodeIds();
      const expandedIds2 = provider.getExpandedNodeIds();

      expect(expandedIds1).not.toBe(expandedIds2); // Different instances
      expect(expandedIds1.size).toBe(expandedIds2.size);
      expect(expandedIds1.has('repo-test-test-repo')).toBe(true);
      expect(expandedIds2.has('repo-test-test-repo')).toBe(true);
    });

    it('should return empty set when no nodes are expanded', () => {
      const expandedIds = provider.getExpandedNodeIds();
      expect(expandedIds.size).toBe(0);
    });
  });

  describe('findNodeById', () => {
    beforeEach(() => {
      provider.setRepositories([testRepo]);
    });

    it('should find repo nodes by ID', () => {
      const node = provider.findNodeById('repo-test-test-repo');
      expect(node).toBeDefined();
      expect(node?.type).toBe('repo');
      if (node?.type === 'repo') {
        expect(node.repo.owner).toBe('test');
        expect(node.repo.name).toBe('test-repo');
      }
    });

    it('should find run nodes by ID', () => {
      const run = createTestRun(123, 'test-workflow');
      provider.updateRuns(testRepo, [run]);

      const node = provider.findNodeById('run-test-test-repo-123');
      expect(node).toBeDefined();
      expect(node?.type).toBe('run');
      if (node?.type === 'run') {
        expect(node.run.id).toBe(123);
      }
    });

    it('should find job nodes by ID', () => {
      const run = createTestRun(123, 'test-workflow');
      provider.updateRuns(testRepo, [run]);
      const job = createTestJob(456, 'test-job');
      provider.updateJobs(testRepo, 123, [job]);

      const node = provider.findNodeById('job-test-test-repo-123-456');
      expect(node).toBeDefined();
      expect(node?.type).toBe('job');
      if (node?.type === 'job') {
        expect(node.job.id).toBe(456);
      }
    });

    it('should return undefined for non-existent node IDs', () => {
      const node = provider.findNodeById('nonexistent-id');
      expect(node).toBeUndefined();
    });

    it('should find workflow group nodes in workflows mode', () => {
      const workflowsProvider = new ActionsTreeProvider('workflows');
      workflowsProvider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow');
      run.workflowName = 'My Workflow';
      workflowsProvider.updateRuns(testRepo, [run]);

      const node = workflowsProvider.findNodeById('workflow-group-test-test-repo-My Workflow - test/test-repo');
      expect(node).toBeDefined();
      expect(node?.type).toBe('workflowGroup');
    });
  });

  describe('getParent', () => {
    beforeEach(() => {
      provider.setRepositories([testRepo]);
    });

    it('should return repo node as parent of run node', () => {
      const run = createTestRun(123, 'test-workflow');
      provider.updateRuns(testRepo, [run]);

      const runNode: RunNode = {
        type: 'run',
        repo: testRepo,
        run
      };

      const parent = provider.getParent(runNode) as ActionsNode | null;
      expect(parent).toBeDefined();
      expect(parent?.type).toBe('repo');
    });

    it('should return run node as parent of job node', () => {
      const run = createTestRun(123, 'test-workflow');
      provider.updateRuns(testRepo, [run]);
      const job = createTestJob(456, 'test-job');
      provider.updateJobs(testRepo, 123, [job]);

      const jobNode: JobNode = {
        type: 'job',
        runRef: { repo: testRepo, id: 123 },
        job,
        jobIndex: 0
      };

      const parent = provider.getParent(jobNode) as ActionsNode | null;
      expect(parent).toBeDefined();
      expect(parent?.type).toBe('run');
    });

    it('should return job node as parent of step node', () => {
      const run = createTestRun(123, 'test-workflow');
      provider.updateRuns(testRepo, [run]);
      const job = createTestJob(456, 'test-job');
      job.steps = [{ name: 'test-step', status: 'completed', stepIndex: 0 }];
      provider.updateJobs(testRepo, 123, [job]);

      const stepNode = {
        type: 'step' as const,
        runRef: { repo: testRepo, id: 123 },
        job,
        step: job.steps[0],
        jobIndex: 0,
        stepIndex: 0
      };

      const parent = provider.getParent(stepNode) as ActionsNode | null;
      expect(parent).toBeDefined();
      expect(parent?.type).toBe('job');
    });

    it('should return null for root-level nodes', () => {
      const repoNode: RepoNode = {
        type: 'repo',
        repo: testRepo
      };

      const parent = provider.getParent(repoNode);
      expect(parent).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear expansion state when clearing repos', () => {
      const repoNode: RepoNode = {
        type: 'repo',
        repo: testRepo
      };

      provider.setRepositories([testRepo]);
      provider.markExpanded(repoNode);
      expect(provider.getExpandedNodeIds().size).toBeGreaterThan(0);

      provider.clear();
      expect(provider.getExpandedNodeIds().size).toBe(0);
    });
  });

  describe('setRepositories - cleanup of removed repos', () => {
    it('should clean up expansion state for removed repos', () => {
      const repo1: RepoRef = { host: 'gitea.example.com', owner: 'test', name: 'repo1' };
      const repo2: RepoRef = { host: 'gitea.example.com', owner: 'test', name: 'repo2' };

      provider.setRepositories([repo1, repo2]);

      const repo1Node: RepoNode = { type: 'repo', repo: repo1 };
      const repo2Node: RepoNode = { type: 'repo', repo: repo2 };

      provider.markExpanded(repo1Node);
      provider.markExpanded(repo2Node);

      expect(provider.getExpandedNodeIds().has('repo-test-repo1')).toBe(true);
      expect(provider.getExpandedNodeIds().has('repo-test-repo2')).toBe(true);

      // Remove repo2
      provider.setRepositories([repo1]);

      // repo2 expansion state should be cleaned up
      expect(provider.getExpandedNodeIds().has('repo-test-repo1')).toBe(true);
      expect(provider.getExpandedNodeIds().has('repo-test-repo2')).toBe(false);
    });

    it('should clean up expansion state for removed runs and jobs', () => {
      provider.setRepositories([testRepo]);
      const run1 = createTestRun(1, 'workflow1');
      const run2 = createTestRun(2, 'workflow2');
      provider.updateRuns(testRepo, [run1, run2]);

      const job1 = createTestJob(10, 'job1');
      const job2 = createTestJob(20, 'job2');
      provider.updateJobs(testRepo, 1, [job1]);
      provider.updateJobs(testRepo, 2, [job2]);

      const run1Node: RunNode = { type: 'run', repo: testRepo, run: run1 };
      const run2Node: RunNode = { type: 'run', repo: testRepo, run: run2 };
      const job1Node: JobNode = { type: 'job', runRef: { repo: testRepo, id: 1 }, job: job1, jobIndex: 0 };
      const job2Node: JobNode = { type: 'job', runRef: { repo: testRepo, id: 2 }, job: job2, jobIndex: 0 };

      provider.markExpanded(run1Node);
      provider.markExpanded(run2Node);
      provider.markExpanded(job1Node);
      provider.markExpanded(job2Node);

      // Remove run2 (which also removes job2)
      provider.updateRuns(testRepo, [run1]);

      // run2 and job2 expansion state should be cleaned up
      expect(provider.getExpandedNodeIds().has('run-test-test-repo-1')).toBe(true);
      expect(provider.getExpandedNodeIds().has('run-test-test-repo-2')).toBe(false);
      expect(provider.getExpandedNodeIds().has('job-test-test-repo-1-10')).toBe(true);
      expect(provider.getExpandedNodeIds().has('job-test-test-repo-2-20')).toBe(false);
    });
  });

  describe('integration - expansion state preservation', () => {
    it('should preserve expansion state across refresh cycles', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow');
      provider.updateRuns(testRepo, [run]);
      const job = createTestJob(456, 'test-job');
      provider.updateJobs(testRepo, 123, [job]);

      const repoNode: RepoNode = { type: 'repo', repo: testRepo };
      const runNode: RunNode = { type: 'run', repo: testRepo, run };
      const jobNode: JobNode = { type: 'job', runRef: { repo: testRepo, id: 123 }, job, jobIndex: 0 };

      // Mark all as expanded
      provider.markExpanded(repoNode);
      provider.markExpanded(runNode);
      provider.markExpanded(jobNode);

      // Save expansion state
      const expandedIds = provider.getExpandedNodeIds();
      expect(expandedIds.size).toBe(3);

      // Simulate refresh - update runs (this triggers refresh)
      provider.updateRuns(testRepo, [run]);

      // Verify nodes can still be found
      expect(provider.findNodeById('repo-test-test-repo')).toBeDefined();
      expect(provider.findNodeById('run-test-test-repo-123')).toBeDefined();
      expect(provider.findNodeById('job-test-test-repo-123-456')).toBeDefined();
    });
  });

  describe('isRepoInErrorState', () => {
    it('should return true when repo is in error state', () => {
      provider.setRepositories([testRepo]);
      provider.setRepoError(testRepo, 'Test error');
      expect(provider.isRepoInErrorState(testRepo)).toBe(true);
    });

    it('should return false when repo is not in error state', () => {
      provider.setRepositories([testRepo]);
      expect(provider.isRepoInErrorState(testRepo)).toBe(false);
    });

    it('should return false for unknown repo', () => {
      const unknownRepo: RepoRef = { host: 'unknown', owner: 'unknown', name: 'unknown' };
      expect(provider.isRepoInErrorState(unknownRepo)).toBe(false);
    });
  });

  describe('hasRepoBeenLoaded', () => {
    it('should return false when repo has no runs and is not idle', () => {
      provider.setRepositories([testRepo]);
      provider.setRepoLoading(testRepo);
      expect(provider.hasRepoBeenLoaded(testRepo)).toBe(false);
    });

    it('should return true when repo has runs', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow');
      provider.updateRuns(testRepo, [run]);
      expect(provider.hasRepoBeenLoaded(testRepo)).toBe(true);
    });

    it('should return false for unknown repo', () => {
      const unknownRepo: RepoRef = { host: 'unknown', owner: 'unknown', name: 'unknown' };
      expect(provider.hasRepoBeenLoaded(unknownRepo)).toBe(false);
    });
  });
});

describe('ActionsTreeProvider - Targeted Refresh', () => {
  let provider: ActionsTreeProvider;
  const testRepo: RepoRef = {
    host: 'gitea.example.com',
    owner: 'test',
    name: 'test-repo'
  };

  const createTestRun = (id: number | string, name: string, status: 'running' | 'queued' | 'completed' = 'completed'): WorkflowRun => ({
    id,
    name,
    status,
    conclusion: status === 'completed' ? 'success' : undefined,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z'
  });

  const createTestJob = (id: number | string, name: string): Job => ({
    id,
    name,
    status: 'completed',
    conclusion: 'success',
    startedAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:00:00Z'
  });

  beforeEach(() => {
    provider = new ActionsTreeProvider('runs');
  });

  describe('updateRuns - targeted refresh based on changes', () => {
    it('should not trigger refresh when completed runs are updated with same data', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'completed');
      provider.updateRuns(testRepo, [run]);
      
      // Update with the same run data
      provider.updateRuns(testRepo, [run]);
      
      // Expansion state should be preserved (no full refresh happened)
      const repoNode: RepoNode = { type: 'repo', repo: testRepo };
      provider.markExpanded(repoNode);
      expect(provider.getExpandedNodeIds().has('repo-test-test-repo')).toBe(true);
    });

    it('should refresh repo node when membership changes (new run)', () => {
      provider.setRepositories([testRepo]);
      const run1 = createTestRun(1, 'workflow1', 'completed');
      provider.updateRuns(testRepo, [run1]);
      
      // Add a new run
      const run2 = createTestRun(2, 'workflow2', 'completed');
      provider.updateRuns(testRepo, [run1, run2]);
      
      // Both runs should be findable
      expect(provider.findNodeById('run-test-test-repo-1')).toBeDefined();
      expect(provider.findNodeById('run-test-test-repo-2')).toBeDefined();
    });

    it('should refresh repo node when order changes', () => {
      provider.setRepositories([testRepo]);
      const run1 = createTestRun(1, 'workflow1', 'completed');
      const run2 = createTestRun(2, 'workflow2', 'completed');
      provider.updateRuns(testRepo, [run1, run2]);
      
      // Reorder runs
      provider.updateRuns(testRepo, [run2, run1]);
      
      // Both runs should still be findable
      expect(provider.findNodeById('run-test-test-repo-1')).toBeDefined();
      expect(provider.findNodeById('run-test-test-repo-2')).toBeDefined();
    });
  });

  describe('updateJobs - conditional refresh for active runs', () => {
    it('should refresh run node when jobs are first loaded', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'completed');
      provider.updateRuns(testRepo, [run]);
      
      // First time loading jobs
      const job = createTestJob(456, 'test-job');
      provider.updateJobs(testRepo, 123, [job]);
      
      // Job should be findable
      expect(provider.findNodeById('job-test-test-repo-123-456')).toBeDefined();
    });

    it('should not refresh completed run when jobs are updated again', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'completed');
      provider.updateRuns(testRepo, [run]);
      
      // First load
      const job = createTestJob(456, 'test-job');
      provider.updateJobs(testRepo, 123, [job]);
      
      // Update again with same jobs (should not refresh since run is completed)
      provider.updateJobs(testRepo, 123, [job]);
      
      // Job should still be findable
      expect(provider.findNodeById('job-test-test-repo-123-456')).toBeDefined();
    });

    it('should always refresh active run when jobs are updated', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'running');
      provider.updateRuns(testRepo, [run]);
      
      // First load
      const job = createTestJob(456, 'test-job');
      provider.updateJobs(testRepo, 123, [job]);
      
      // Update again (should refresh since run is active)
      const updatedJob = { ...job, status: 'running' as const };
      provider.updateJobs(testRepo, 123, [updatedJob]);
      
      // Job should be findable
      expect(provider.findNodeById('job-test-test-repo-123-456')).toBeDefined();
    });
  });

  describe('setRepoLoading - conditional refresh', () => {
    it('should not refresh when repo already has runs', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'completed');
      provider.updateRuns(testRepo, [run]);
      
      // Mark repo as loading (should not trigger refresh)
      provider.setRepoLoading(testRepo);
      
      // Run should still be findable
      expect(provider.findNodeById('run-test-test-repo-123')).toBeDefined();
    });

    it('should refresh when repo is in error state', () => {
      provider.setRepositories([testRepo]);
      provider.setRepoError(testRepo, 'Test error');
      
      expect(provider.isRepoInErrorState(testRepo)).toBe(true);
      
      // Set loading (should trigger refresh to clear error)
      provider.setRepoLoading(testRepo);
      
      // Should no longer be in error state
      expect(provider.isRepoInErrorState(testRepo)).toBe(false);
    });
  });

  describe('getExpandedRunRefsNeedingJobs', () => {
    it('should return empty array when no runs are expanded', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'completed');
      provider.updateRuns(testRepo, [run]);
      
      const needingJobs = provider.getExpandedRunRefsNeedingJobs();
      expect(needingJobs).toHaveLength(0);
    });

    it('should return expanded run with unloaded jobs', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'completed');
      provider.updateRuns(testRepo, [run]);
      
      // Mark run as expanded
      const runNode: RunNode = { type: 'run', repo: testRepo, run };
      provider.markExpanded(runNode);
      
      const needingJobs = provider.getExpandedRunRefsNeedingJobs();
      expect(needingJobs).toHaveLength(1);
      expect(needingJobs[0].id).toBe(123);
    });

    it('should return expanded run with loading jobs', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'completed');
      provider.updateRuns(testRepo, [run]);
      
      // Mark run as expanded
      const runNode: RunNode = { type: 'run', repo: testRepo, run };
      provider.markExpanded(runNode);
      
      // Set jobs to loading state
      provider.setRunJobsLoading(testRepo, 123);
      
      const needingJobs = provider.getExpandedRunRefsNeedingJobs();
      expect(needingJobs).toHaveLength(1);
      expect(needingJobs[0].id).toBe(123);
    });

    it('should return expanded run with error jobs', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'completed');
      provider.updateRuns(testRepo, [run]);
      
      // Mark run as expanded
      const runNode: RunNode = { type: 'run', repo: testRepo, run };
      provider.markExpanded(runNode);
      
      // Set jobs to error state
      provider.setRunJobsError(testRepo, 123, 'Test error');
      
      const needingJobs = provider.getExpandedRunRefsNeedingJobs();
      expect(needingJobs).toHaveLength(1);
      expect(needingJobs[0].id).toBe(123);
    });

    it('should NOT return expanded run with loaded jobs', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'completed');
      provider.updateRuns(testRepo, [run]);
      
      // Mark run as expanded
      const runNode: RunNode = { type: 'run', repo: testRepo, run };
      provider.markExpanded(runNode);
      
      // Load jobs successfully
      const job = createTestJob(456, 'test-job');
      provider.updateJobs(testRepo, 123, [job]);
      
      const needingJobs = provider.getExpandedRunRefsNeedingJobs();
      expect(needingJobs).toHaveLength(0);
    });

    it('should NOT return collapsed run with unloaded jobs', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'completed');
      provider.updateRuns(testRepo, [run]);
      
      // Mark run as expanded then collapsed
      const runNode: RunNode = { type: 'run', repo: testRepo, run };
      provider.markExpanded(runNode);
      provider.markCollapsed(runNode);
      
      const needingJobs = provider.getExpandedRunRefsNeedingJobs();
      expect(needingJobs).toHaveLength(0);
    });

    it('should return multiple expanded runs needing jobs', () => {
      provider.setRepositories([testRepo]);
      const run1 = createTestRun(1, 'workflow1', 'completed');
      const run2 = createTestRun(2, 'workflow2', 'completed');
      provider.updateRuns(testRepo, [run1, run2]);
      
      // Mark both runs as expanded
      const runNode1: RunNode = { type: 'run', repo: testRepo, run: run1 };
      const runNode2: RunNode = { type: 'run', repo: testRepo, run: run2 };
      provider.markExpanded(runNode1);
      provider.markExpanded(runNode2);
      
      const needingJobs = provider.getExpandedRunRefsNeedingJobs();
      expect(needingJobs).toHaveLength(2);
    });
  });

  describe('shouldPollJobs', () => {
    it('should return true when run is expanded and jobs are unloaded', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'running');
      provider.updateRuns(testRepo, [run]);

      const runNode: RunNode = { type: 'run', repo: testRepo, run };
      provider.markExpanded(runNode);

      expect(provider.shouldPollJobs(testRepo, 123)).toBe(true);
    });

    it('should return true when jobs are loaded even if run is collapsed', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'running');
      provider.updateRuns(testRepo, [run]);

      const runNode: RunNode = { type: 'run', repo: testRepo, run };
      provider.markExpanded(runNode);

      const job = createTestJob(456, 'test-job');
      provider.updateJobs(testRepo, 123, [job]);

      provider.markCollapsed(runNode);

      expect(provider.shouldPollJobs(testRepo, 123)).toBe(true);
    });

    it('should return false when run is collapsed and jobs are unloaded', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'running');
      provider.updateRuns(testRepo, [run]);

      expect(provider.shouldPollJobs(testRepo, 123)).toBe(false);
    });
  });

  describe('resetJobCaches', () => {
    it('should reset job caches to unloaded for collapsed runs', () => {
      provider.setRepositories([testRepo]);
      const run = createTestRun(123, 'test-workflow', 'running');
      provider.updateRuns(testRepo, [run]);

      const job = createTestJob(456, 'test-job');
      provider.updateJobs(testRepo, 123, [job]);

      provider.resetJobCaches();

      expect(provider.shouldPollJobs(testRepo, 123)).toBe(false);
    });
  });
});
