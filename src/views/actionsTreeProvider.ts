import * as vscode from 'vscode';
import { ActionsNode, MessageNode, RunNode, WorkflowGroupNode, JobNode, RepoNode, toTreeItem } from './nodes';
import { RepoRef, RunRef, WorkflowRun, Job, toRunRef } from '../gitea/models';

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
  private readonly repoNodes = new Map<RepoKey, RepoNode>();
  private readonly runNodes = new Map<string, RunNode>();
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
      return repoStates.map<RepoNode>((state) => this.getRepoNode(state.repo, autoExpand));
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
      return state.runs.map<RunNode>((run) =>
        this.upsertRunNode(element.repo, this.getDisplayRun(state, run))
      );
    }

    if (element.type === 'workflowGroup') {
      return element.runs.map<RunNode>((run) => this.upsertRunNode(element.repo, run));
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
        return this.getRepoNode(element.repo);
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
          return this.upsertRunNode(element.runRef.repo, run);
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
        this.repoNodes.delete(removedKey);
        if (repoState) {
          for (const run of repoState.runs) {
            this.runNodes.delete(this.runNodeKey(repoState.repo, run.id));
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
        this.refresh(this.getRepoNode(repo));
      }
    }
  }

  setRepoError(repo: RepoRef, error: string): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.state = 'error';
      state.error = error;
      // Refresh only the repo node to preserve expansion state
      this.refresh(this.getRepoNode(repo));
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
        this.runNodes.delete(this.runNodeKey(repo, oldRun.id));
        
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
    
    // Find runs whose status/data changed
    const changedRuns: WorkflowRun[] = [];
    for (const newRun of runs) {
      const oldRun = oldRunMap.get(String(newRun.id));
      if (!oldRun || hasRunChanged(oldRun, newRun)) {
        changedRuns.push(newRun);
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
      // Membership or order changed - full refresh to ensure children update.
      this.refresh();
    } else if (changedRuns.length > 0) {
      // Only changed runs - refresh those run nodes
      for (const run of changedRuns) {
        const displayRun = this.getDisplayRun(state, run);
        const runNode = this.upsertRunNode(repo, displayRun);
        this.refresh(runNode);
      }
    }
    // If nothing changed, don't refresh at all
  }

  /**
   * Updates the job cache for a run.
   * @param repo - Repository reference
   * @param runId - Run ID
   * @param jobs - Jobs to cache
   * @param runNode - Optional: the actual expanded RunNode instance for proper refresh
   */
  updateJobs(repo: RepoRef, runId: number | string, jobs: Job[], runNode?: RunNode): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.jobs.set(runId, { state: 'idle', jobs });
      state.inFlightJobs.delete(runId);
      
      // Refresh the run node whenever job data changes to keep status in sync.
      const run = state.runs.find((r) => String(r.id) === String(runId));
      if (run) {
        const displayRun = this.getDisplayRun(state, run);
        const nodeToRefresh = this.upsertRunNode(repo, displayRun, runNode);
        this.refresh(nodeToRefresh);
      }
    }
  }

  /**
   * Sets the job cache to loading state for a run.
   * @param repo - Repository reference
   * @param runId - Run ID
   * @param runNode - Optional: the actual expanded RunNode instance for proper refresh
   */
  setRunJobsLoading(repo: RepoRef, runId: number | string, runNode?: RunNode): void {
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
        const displayRun = this.getDisplayRun(state, run);
        const nodeToRefresh = this.upsertRunNode(repo, displayRun, runNode);
        this.refresh(nodeToRefresh);
      }
    }
  }

  /**
   * Sets the job cache to error state for a run.
   * @param repo - Repository reference
   * @param runId - Run ID
   * @param error - Error message
   * @param runNode - Optional: the actual expanded RunNode instance for proper refresh
   */
  setRunJobsError(repo: RepoRef, runId: number | string, error: string, runNode?: RunNode): void {
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
          const displayRun = this.getDisplayRun(state, run);
          const nodeToRefresh = this.upsertRunNode(repo, displayRun, runNode);
          this.refresh(nodeToRefresh);
        }
      }
    }
  }

  clear(): void {
    this.repos.clear();
    this.repoNodes.clear();
    this.runNodes.clear();
    this.configErrors = [];
    this.expandedNodeIds.clear();
    this.refresh();
  }

  resetJobCaches(): void {
    for (const state of this.repos.values()) {
      const nextJobs = new Map<string | number, JobCache>();
      for (const run of state.runs) {
        nextJobs.set(run.id, { state: 'unloaded', jobs: [] });
      }
      state.jobs = nextJobs;
      state.inFlightJobs.clear();
    }
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

  shouldPollJobs(repo: RepoRef, runId: number | string): boolean {
    const state = this.repos.get(repoKey(repo));
    if (!state) {
      return false;
    }
    const runNodeId = `run-${repo.owner}-${repo.name}-${runId}`;
    if (this.expandedNodeIds.has(runNodeId)) {
      return true;
    }
    const cache = state.jobs.get(runId);
    return !!cache && cache.state !== 'unloaded';
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
   * Gets run refs for expanded runs that need jobs to be loaded.
   * Returns runs where:
   * - The run node is currently expanded
   * - Job cache is unloaded, loading, or error state
   */
  getExpandedRunRefsNeedingJobs(): RunRef[] {
    const result: RunRef[] = [];
    
    for (const state of this.repos.values()) {
      for (const run of state.runs) {
        // Check if this run is expanded
        const runId = `run-${state.repo.owner}-${state.repo.name}-${run.id}`;
        if (!this.expandedNodeIds.has(runId)) {
          continue;
        }
        
        // Check if jobs need to be loaded
        const jobCache = state.jobs.get(run.id);
        const needsJobs = !jobCache || 
          jobCache.state === 'unloaded' || 
          jobCache.state === 'loading' || 
          jobCache.state === 'error';
        
        if (needsJobs) {
          result.push(toRunRef(state.repo, run));
        }
      }
    }
    
    return result;
  }

  /**
   * Finds a node by its ID. Used to restore expansion state.
   */
  findNodeById(id: string): ActionsNode | undefined {
    // Check repo nodes
    for (const [, state] of this.repos.entries()) {
      const repoId = `repo-${state.repo.owner}-${state.repo.name}`;
      if (repoId === id) {
        return this.getRepoNode(state.repo, true);
      }

      // Check run nodes
      for (const run of state.runs) {
        const runId = `run-${state.repo.owner}-${state.repo.name}-${run.id}`;
        if (runId === id) {
          return this.upsertRunNode(state.repo, run);
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
        results.push({ repo: state.repo, run: this.getDisplayRun(state, run) });
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
    const groups = new Map<string, { name: string; repo: RepoRef; runs: { repo: RepoRef; run: WorkflowRun }[] }>();
    for (const entry of this.collectRuns()) {
      const workflowName = entry.run.workflowName ?? entry.run.name;
      const repoLabel = `${entry.repo.owner}/${entry.repo.name}`;
      const displayName = `${workflowName} - ${repoLabel}`;
      const groupKey = `${repoLabel}::${workflowName}`;
      const existing = groups.get(groupKey);
      if (!existing) {
        groups.set(groupKey, { name: displayName, repo: entry.repo, runs: [entry] });
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
      repo: group.repo
    }));
  }

  private hasLoadingJobs(): boolean {
    return Array.from(this.repos.values()).some((state) =>
      Array.from(state.jobs.values()).some((cache) => cache.state === 'loading' || cache.state === 'unloaded')
    );
  }

  private getRepoNode(repo: RepoRef, expanded?: boolean): RepoNode {
    const key = repoKey(repo);
    let node = this.repoNodes.get(key);
    if (!node) {
      node = { type: 'repo', repo };
      this.repoNodes.set(key, node);
    }
    node.repo = repo;
    if (expanded !== undefined) {
      node.expanded = expanded;
    }
    return node;
  }

  private upsertRunNode(repo: RepoRef, run: WorkflowRun, existing?: RunNode): RunNode {
    const key = this.runNodeKey(repo, run.id);
    const node = existing ?? this.runNodes.get(key) ?? { type: 'run', repo, run };
    node.repo = repo;
    node.run = run;
    this.runNodes.set(key, node);
    return node;
  }

  private runNodeKey(repo: RepoRef, runId: number | string): string {
    return `${repoKey(repo)}#${runId}`;
  }

  private getDisplayRun(state: RepoState, run: WorkflowRun): WorkflowRun {
    const cache = state.jobs.get(run.id);
    if (!cache || cache.state !== 'idle' || cache.jobs.length === 0) {
      return run;
    }
    const hasActive = cache.jobs.some((job) => job.status === 'running' || job.status === 'queued');
    const allCompleted = cache.jobs.every((job) => job.status === 'completed');
    let derivedStatus: WorkflowRun['status'] | undefined;
    if (hasActive) {
      derivedStatus = 'running';
    } else if (allCompleted) {
      derivedStatus = 'completed';
    } else {
      return run;
    }
    const rank: Record<WorkflowRun['status'], number> = {
      queued: 0,
      running: 1,
      completed: 2,
      unknown: 0
    };
    if (rank[derivedStatus] <= rank[run.status]) {
      return run;
    }
    const next: WorkflowRun = { ...run, status: derivedStatus };
    if (derivedStatus === 'completed' && (!run.conclusion || run.conclusion === 'unknown')) {
      const conclusion = deriveConclusion(cache.jobs);
      if (conclusion) {
        next.conclusion = conclusion;
      }
    }
    return next;
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

function deriveConclusion(jobs: Job[]): WorkflowRun['conclusion'] | undefined {
  if (jobs.some((job) => job.conclusion === 'failure')) {
    return 'failure';
  }
  if (jobs.some((job) => job.conclusion === 'cancelled')) {
    return 'cancelled';
  }
  if (jobs.some((job) => job.conclusion === 'skipped')) {
    return 'skipped';
  }
  if (jobs.some((job) => job.conclusion === 'success')) {
    return 'success';
  }
  return undefined;
}
