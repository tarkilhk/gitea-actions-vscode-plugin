import * as vscode from 'vscode';
import { ActionsNode, MessageNode, RunNode, WorkflowGroupNode, JobNode, RepoNode, toTreeItem } from './nodes';
import { RepoRef, WorkflowRun, Job, toRunRef } from '../gitea/models';

type RepoKey = string;

type RepoState = {
  repo: RepoRef;
  runs: WorkflowRun[];
  jobs: Map<string | number, JobCache>;
  inFlightJobs: Map<string | number, Promise<void>>;
  state: 'idle' | 'loading' | 'error';
  error?: string;
};

type JobCache = {
  state: 'unloaded' | 'loading' | 'idle' | 'error';
  jobs: Job[];
  error?: string;
};

type ProviderMode = 'runs' | 'workflows';

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionsNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ActionsNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly repos = new Map<RepoKey, RepoState>();
  private configErrors: Array<{ message: string; action: 'configureBaseUrl' | 'setToken' }> = [];
  
  // Track expanded nodes to preserve state across refreshes
  private readonly expandedNodeIds = new Set<string>();

  constructor(private readonly mode: ProviderMode = 'runs') {}

  getTreeItem(element: ActionsNode): vscode.TreeItem {
    return toTreeItem(element);
  }

  getChildren(element?: ActionsNode): vscode.ProviderResult<ActionsNode[]> {
    if (!element) {
      if (!this.repos.size) {
        if (this.configErrors.length > 0) {
          // If configuration is missing, show separate messages for each missing config
          return this.configErrors.map((error): MessageNode => ({
            type: 'message',
            message: error.message,
            severity: 'info',
            action: error.action
          }));
        } else {
          // If configured but no repos found, mention opening a repo
          const message: MessageNode = {
            type: 'message',
            message: 'No repositories found. Open a Gitea repository to view runs.',
            severity: 'info'
          };
          return [message];
        }
      }
      const errored = Array.from(this.repos.values()).find((state) => state.state === 'error');
      if (errored) {
        const message: MessageNode = {
          type: 'message',
          repo: errored.repo,
          message: errored.error ?? 'Failed to load runs',
          severity: 'error'
        };
        return [message];
      }
      if (this.mode === 'workflows') {
        const groups = this.buildWorkflowGroups();
        if (!groups.length) {
          return [
            {
              type: 'message',
              message: this.hasLoadingJobs() ? 'Loading jobs...' : 'No runs yet',
              severity: 'info'
            } satisfies MessageNode
          ];
        }
        return groups;
      }
      // For 'runs' mode: always show repo nodes at top level for consistency
      const repoStates = Array.from(this.repos.values())
        .filter((state) => state.state !== 'error');
      if (!repoStates.length) {
        return [
          {
            type: 'message',
            message: this.hasLoadingJobs() ? 'Loading...' : 'No runs yet',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      // Auto-expand when there's only one repo
      const autoExpand = repoStates.length === 1;
      return repoStates.map<RepoNode>((state) => ({
        type: 'repo',
        repo: state.repo,
        expanded: autoExpand
      }));
    }

    // Handle repo node expansion - show runs for this repo
    if (element.type === 'repo') {
      const state = this.repos.get(repoKey(element.repo));
      if (!state || state.state === 'error') {
        return [];
      }
      if (!state.runs.length) {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: state.state === 'loading' ? 'Loading runs...' : 'No runs yet',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      return state.runs.map<RunNode>((run) => ({
        type: 'run',
        repo: element.repo,
        run
      }));
    }

    if (element.type === 'workflowGroup') {
      return element.runs.map<RunNode>((run) => ({
        type: 'run',
        repo: element.repo,
        run
      }));
    }

    if (element.type === 'run') {
      const repoState = this.repos.get(repoKey(element.repo));
      if (!repoState) {
        return [];
      }
      const cache = repoState.jobs.get(element.run.id);
      if (!cache || cache.state === 'unloaded') {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: 'Expand to load jobs',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      if (cache.state === 'loading') {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: 'Loading jobs...',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      if (cache.state === 'error') {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: cache.error ?? 'Failed to load jobs',
            severity: 'error'
          } satisfies MessageNode
        ];
      }
      if (!cache.jobs.length) {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: 'No jobs yet',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      const runRef = toRunRef(element.repo, element.run);
      return cache.jobs.map<JobNode>((job, index) => ({
        type: 'job',
        runRef,
        job,
        jobIndex: index
      }));
    }

    if (element.type === 'job') {
      const steps = element.job.steps ?? [];
      if (!steps.length) {
        return [
          {
            type: 'message',
            repo: element.runRef.repo,
            message: 'No steps reported',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      return steps.map((step, index) => ({
        type: 'step',
        runRef: element.runRef,
        job: element.job,
        step,
        jobIndex: element.jobIndex,
        stepIndex: index
      }));
    }

    return [];
  }

  getParent(element: ActionsNode): vscode.ProviderResult<ActionsNode> {
    // Return parent node for reveal() API to work
    if (element.type === 'run') {
      // Run nodes are children of repo nodes (in runs mode) or workflow group nodes (in workflows mode)
      if (this.mode === 'runs') {
        return {
          type: 'repo',
          repo: element.repo
        };
      } else {
        // In workflows mode, find the workflow group
        const workflowName = element.run.workflowName ?? element.run.name;
        return {
          type: 'workflowGroup',
          name: workflowName,
          runs: [],
          repo: element.repo
        };
      }
    }
    if (element.type === 'job') {
      // Job nodes are children of run nodes
      const repoState = this.repos.get(repoKey(element.runRef.repo));
      if (repoState) {
        const run = repoState.runs.find((r) => String(r.id) === String(element.runRef.id));
        if (run) {
          return {
            type: 'run',
            repo: element.runRef.repo,
            run
          };
        }
      }
    }
    if (element.type === 'step') {
      // Step nodes are children of job nodes
      return {
        type: 'job',
        runRef: element.runRef,
        job: element.job,
        jobIndex: element.jobIndex
      };
    }
    // Repo nodes, workflow group nodes, and message nodes have no parent (they're root-level)
    return null;
  }

  setRepositories(repos: RepoRef[]): void {
    const next = new Map<RepoKey, RepoState>();
    const nextRepoKeys = new Set<RepoKey>();
    for (const repo of repos) {
      const key = repoKey(repo);
      nextRepoKeys.add(key);
      const existing = this.repos.get(key);
      next.set(key, {
        repo,
        runs: existing?.runs ?? [],
        jobs: existing?.jobs ?? new Map(),
        inFlightJobs: existing?.inFlightJobs ?? new Map(),
        state: existing?.state ?? 'idle',
        error: existing?.error
      });
    }
    
    // Clean up expansion state for removed repos
    const currentRepoKeys = new Set(this.repos.keys());
    for (const removedKey of currentRepoKeys) {
      if (!nextRepoKeys.has(removedKey)) {
        // Remove all expanded node IDs for this repo
        const repoState = this.repos.get(removedKey);
        if (repoState) {
          const repoId = `repo-${repoState.repo.owner}-${repoState.repo.name}`;
          this.expandedNodeIds.delete(repoId);
          // Also remove run and job IDs for this repo
          for (const run of repoState.runs) {
            const runId = `run-${repoState.repo.owner}-${repoState.repo.name}-${run.id}`;
            this.expandedNodeIds.delete(runId);
            const jobCache = repoState.jobs.get(run.id);
            if (jobCache && jobCache.jobs) {
              for (const job of jobCache.jobs) {
                const jobId = `job-${repoState.repo.owner}-${repoState.repo.name}-${run.id}-${job.id}`;
                this.expandedNodeIds.delete(jobId);
              }
            }
          }
        }
      }
    }
    
    this.repos.clear();
    next.forEach((value, key) => this.repos.set(key, value));
    this.configErrors = [];
    this.refresh();
  }

  setRepoLoading(repo: RepoRef): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      const wasErrorOrEmpty = state.state === 'error' || state.runs.length === 0;
      
      state.state = 'loading';
      state.error = undefined;
      state.inFlightJobs.clear();
      
      // Only refresh if the repo was in error state or has no runs yet
      // This avoids unnecessary refreshes during normal polling
      if (wasErrorOrEmpty) {
        const repoNode: RepoNode = {
          type: 'repo',
          repo
        };
        this.refresh(repoNode);
      }
    }
  }

  setRepoError(repo: RepoRef, error: string): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.state = 'error';
      state.error = error;
      // Refresh only the repo node to preserve expansion state
      const repoNode: RepoNode = {
        type: 'repo',
        repo
      };
      this.refresh(repoNode);
    }
  }

  updateRuns(repo: RepoRef, runs: WorkflowRun[]): void {
    const state = this.repos.get(repoKey(repo));
    if (!state) {
      return;
    }
    
    const oldRuns = state.runs;
    const newRunIds = new Set(runs.map(r => String(r.id)));
    const oldRunIds = new Set(oldRuns.map(r => String(r.id)));
    const oldRunMap = new Map(oldRuns.map(r => [String(r.id), r]));
    
    // Clean up expansion state for removed runs and their jobs
    for (const oldRun of oldRuns) {
      if (!newRunIds.has(String(oldRun.id))) {
        const runId = `run-${repo.owner}-${repo.name}-${oldRun.id}`;
        this.expandedNodeIds.delete(runId);
        
        const jobCache = state.jobs.get(oldRun.id);
        if (jobCache && jobCache.jobs) {
          for (const job of jobCache.jobs) {
            const jobId = `job-${repo.owner}-${repo.name}-${oldRun.id}-${job.id}`;
            this.expandedNodeIds.delete(jobId);
          }
        }
      }
    }
    
    // Detect what changed
    const membershipChanged = detectMembershipChange(oldRunIds, newRunIds);
    const orderChanged = detectOrderChange(oldRuns, runs);
    
    // Find active runs whose status/data changed
    const changedActiveRuns: WorkflowRun[] = [];
    for (const newRun of runs) {
      const isActive = newRun.status === 'running' || newRun.status === 'queued';
      if (isActive) {
        const oldRun = oldRunMap.get(String(newRun.id));
        if (!oldRun || hasRunChanged(oldRun, newRun)) {
          changedActiveRuns.push(newRun);
        }
      }
    }
    
    // Update state
    state.runs = runs;
    state.state = 'idle';
    state.error = undefined;
    const nextJobs = new Map<string | number, JobCache>();
    for (const run of runs) {
      nextJobs.set(run.id, state.jobs.get(run.id) ?? { state: 'unloaded', jobs: [] });
    }
    state.jobs = nextJobs;
    state.inFlightJobs = new Map();
    
    // Decide what to refresh
    if (membershipChanged || orderChanged) {
      // Membership or order changed - refresh the repo node
      const repoNode: RepoNode = {
        type: 'repo',
        repo
      };
      this.refresh(repoNode);
    } else if (changedActiveRuns.length > 0) {
      // Only active runs changed - refresh only those run nodes
      for (const run of changedActiveRuns) {
        const runNode: RunNode = {
          type: 'run',
          repo,
          run
        };
        this.refresh(runNode);
      }
    }
    // If nothing changed, don't refresh at all
  }

  updateJobs(repo: RepoRef, runId: number | string, jobs: Job[]): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      const previousCache = state.jobs.get(runId);
      const wasUnloadedOrLoading = !previousCache || previousCache.state === 'unloaded' || previousCache.state === 'loading';
      
      state.jobs.set(runId, { state: 'idle', jobs });
      state.inFlightJobs.delete(runId);
      
      // Refresh the run node if:
      // 1. The run is active (needs live updates), OR
      // 2. Jobs were previously unloaded/loading (user just expanded this run)
      const run = state.runs.find((r) => String(r.id) === String(runId));
      if (run) {
        const isActive = run.status === 'running' || run.status === 'queued';
        if (isActive || wasUnloadedOrLoading) {
          const runNode: RunNode = {
            type: 'run',
            repo,
            run
          };
          this.refresh(runNode);
        }
      }
    }
  }

  setRunJobsLoading(repo: RepoRef, runId: number | string): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      const previousCache = state.jobs.get(runId);
      const wasUnloadedOrError = !previousCache || previousCache.state === 'unloaded' || previousCache.state === 'error';
      
      state.jobs.set(runId, { state: 'loading', jobs: previousCache?.jobs ?? [] });
      state.inFlightJobs.delete(runId);
      
      // This method is only called for user-initiated expands, so always refresh
      // to show the loading indicator. But only if jobs weren't already loaded.
      const run = state.runs.find((r) => String(r.id) === String(runId));
      if (run && wasUnloadedOrError) {
        const runNode: RunNode = {
          type: 'run',
          repo,
          run
        };
        this.refresh(runNode);
      }
    }
  }

  setRunJobsError(repo: RepoRef, runId: number | string, error: string): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      const previousCache = state.jobs.get(runId);
      const wasUnloadedOrLoading = !previousCache || previousCache.state === 'unloaded' || previousCache.state === 'loading';
      
      state.jobs.set(runId, { state: 'error', jobs: [], error });
      state.inFlightJobs.delete(runId);
      
      // Refresh if:
      // 1. The run is active (needs live updates), OR
      // 2. Jobs were previously unloaded/loading (user just expanded this run)
      const run = state.runs.find((r) => String(r.id) === String(runId));
      if (run) {
        const isActive = run.status === 'running' || run.status === 'queued';
        if (isActive || wasUnloadedOrLoading) {
          const runNode: RunNode = {
            type: 'run',
            repo,
            run
          };
          this.refresh(runNode);
        }
      }
    }
  }

  clear(): void {
    this.repos.clear();
    this.configErrors = [];
    this.expandedNodeIds.clear();
    this.refresh();
  }

  setConfigErrors(errors: Array<{ message: string; action: 'configureBaseUrl' | 'setToken' }>): void {
    this.configErrors = errors;
    this.refresh();
  }

  /**
   * Checks if a repo is currently in error state.
   */
  isRepoInErrorState(repo: RepoRef): boolean {
    const state = this.repos.get(repoKey(repo));
    return state?.state === 'error';
  }

  /**
   * Checks if a repo has any cached runs (i.e., has been loaded at least once).
   */
  hasRepoBeenLoaded(repo: RepoRef): boolean {
    const state = this.repos.get(repoKey(repo));
    return state ? state.runs.length > 0 || state.state === 'idle' : false;
  }

  refresh(node?: ActionsNode): void {
    if (!node) {
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }
    this.onDidChangeTreeDataEmitter.fire(node);
  }

  /**
   * Marks a node as expanded. Called by the tree view when a node is expanded.
   */
  markExpanded(node: ActionsNode): void {
    const treeItem = toTreeItem(node);
    if (treeItem.id) {
      this.expandedNodeIds.add(treeItem.id);
    }
  }

  /**
   * Marks a node as collapsed. Called by the tree view when a node is collapsed.
   */
  markCollapsed(node: ActionsNode): void {
    const treeItem = toTreeItem(node);
    if (treeItem.id) {
      this.expandedNodeIds.delete(treeItem.id);
    }
  }

  /**
   * Gets the set of expanded node IDs. Used to restore expansion state after refresh.
   */
  getExpandedNodeIds(): Set<string> {
    return new Set(this.expandedNodeIds);
  }

  /**
   * Finds a node by its ID. Used to restore expansion state.
   */
  findNodeById(id: string): ActionsNode | undefined {
    // Check repo nodes
    for (const [key, state] of this.repos.entries()) {
      const repoId = `repo-${state.repo.owner}-${state.repo.name}`;
      if (repoId === id) {
        return {
          type: 'repo',
          repo: state.repo,
          expanded: true
        };
      }

      // Check run nodes
      for (const run of state.runs) {
        const runId = `run-${state.repo.owner}-${state.repo.name}-${run.id}`;
        if (runId === id) {
          return {
            type: 'run',
            repo: state.repo,
            run
          };
        }

        // Check job nodes
        const jobCache = state.jobs.get(run.id);
        if (jobCache && jobCache.state === 'idle' && jobCache.jobs) {
          for (let jobIndex = 0; jobIndex < jobCache.jobs.length; jobIndex++) {
            const job = jobCache.jobs[jobIndex];
            const jobId = `job-${state.repo.owner}-${state.repo.name}-${run.id}-${job.id}`;
            if (jobId === id) {
              return {
                type: 'job',
                runRef: toRunRef(state.repo, run),
                job,
                jobIndex
              };
            }
          }
        }
      }
    }

    // Check workflow group nodes (for workflows mode)
    if (this.mode === 'workflows') {
      const groups = this.buildWorkflowGroups();
      for (const group of groups) {
        const groupId = `workflow-group-${group.repo.owner}-${group.repo.name}-${group.name}`;
        if (groupId === id) {
          return group;
        }
      }
    }

    return undefined;
  }

  private collectRuns(): { repo: RepoRef; run: WorkflowRun }[] {
    const results: { repo: RepoRef; run: WorkflowRun }[] = [];
    for (const state of this.repos.values()) {
      if (state.state === 'error') {
        continue;
      }
      for (const run of state.runs) {
        results.push({ repo: state.repo, run });
      }
    }
    // Sort: running/queued runs first (prioritized), then by time descending
    results.sort((a, b) => {
      const aActive = a.run.status === 'running' || a.run.status === 'queued';
      const bActive = b.run.status === 'running' || b.run.status === 'queued';
      // Active runs come first
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      // Within same category, sort by most recent time
      const aTime = a.run.updatedAt ?? a.run.completedAt ?? a.run.startedAt ?? a.run.createdAt ?? '';
      const bTime = b.run.updatedAt ?? b.run.completedAt ?? b.run.startedAt ?? b.run.createdAt ?? '';
      return bTime.localeCompare(aTime);
    });
    return results;
  }

  private buildWorkflowGroups(): WorkflowGroupNode[] {
    const groups = new Map<string, { name: string; runs: { repo: RepoRef; run: WorkflowRun }[] }>();
    for (const entry of this.collectRuns()) {
      const workflowName = entry.run.workflowName ?? entry.run.name;
      const existing = groups.get(workflowName);
      if (!existing) {
        groups.set(workflowName, { name: workflowName, runs: [entry] });
      } else {
        existing.runs.push(entry);
      }
    }
    // Sort groups: groups with active runs first, then by time descending
    const ordered = Array.from(groups.values()).sort((a, b) => {
      const aHasActive = a.runs.some(r => r.run.status === 'running' || r.run.status === 'queued');
      const bHasActive = b.runs.some(r => r.run.status === 'running' || r.run.status === 'queued');
      if (aHasActive && !bHasActive) return -1;
      if (!aHasActive && bHasActive) return 1;
      const aTime =
        a.runs[0]?.run.updatedAt ?? a.runs[0]?.run.completedAt ?? a.runs[0]?.run.startedAt ?? a.runs[0]?.run.createdAt ?? '';
      const bTime =
        b.runs[0]?.run.updatedAt ?? b.runs[0]?.run.completedAt ?? b.runs[0]?.run.startedAt ?? b.runs[0]?.run.createdAt ?? '';
      return bTime.localeCompare(aTime);
    });
    return ordered.map<WorkflowGroupNode>((group) => ({
      type: 'workflowGroup',
      name: group.name,
      runs: group.runs.map((r) => r.run),
      repo: group.runs[0]?.repo ?? { host: '', owner: '', name: '' }
    }));
  }

  private hasLoadingJobs(): boolean {
    return Array.from(this.repos.values()).some((state) =>
      Array.from(state.jobs.values()).some((cache) => cache.state === 'loading' || cache.state === 'unloaded')
    );
  }
}

function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

/**
 * Detects if run list membership changed (runs added or removed).
 */
function detectMembershipChange(oldIds: Set<string>, newIds: Set<string>): boolean {
  if (oldIds.size !== newIds.size) {
    return true;
  }
  for (const id of newIds) {
    if (!oldIds.has(id)) {
      return true;
    }
  }
  return false;
}

/**
 * Detects if run list order changed.
 */
function detectOrderChange(oldRuns: WorkflowRun[], newRuns: WorkflowRun[]): boolean {
  if (oldRuns.length !== newRuns.length) {
    return true;
  }
  for (let i = 0; i < oldRuns.length; i++) {
    if (String(oldRuns[i].id) !== String(newRuns[i].id)) {
      return true;
    }
  }
  return false;
}

/**
 * Detects if a run's data has changed in a meaningful way.
 */
function hasRunChanged(oldRun: WorkflowRun, newRun: WorkflowRun): boolean {
  return (
    oldRun.status !== newRun.status ||
    oldRun.conclusion !== newRun.conclusion ||
    oldRun.updatedAt !== newRun.updatedAt ||
    oldRun.completedAt !== newRun.completedAt
  );
}
