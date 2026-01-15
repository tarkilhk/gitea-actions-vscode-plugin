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

  setRepositories(repos: RepoRef[]): void {
    const next = new Map<RepoKey, RepoState>();
    for (const repo of repos) {
      const key = repoKey(repo);
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
    this.repos.clear();
    next.forEach((value, key) => this.repos.set(key, value));
    this.configErrors = [];
    this.refresh();
  }

  setRepoLoading(repo: RepoRef): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.state = 'loading';
      state.error = undefined;
      state.inFlightJobs.clear();
      this.refresh();
    }
  }

  setRepoError(repo: RepoRef, error: string): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.state = 'error';
      state.error = error;
      this.refresh();
    }
  }

  updateRuns(repo: RepoRef, runs: WorkflowRun[]): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.runs = runs;
      state.state = 'idle';
      state.error = undefined;
      const nextJobs = new Map<string | number, JobCache>();
      for (const run of runs) {
        nextJobs.set(run.id, state.jobs.get(run.id) ?? { state: 'unloaded', jobs: [] });
      }
      state.jobs = nextJobs;
      state.inFlightJobs = new Map();
      this.refresh();
    }
  }

  updateJobs(repo: RepoRef, runId: number | string, jobs: Job[]): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.jobs.set(runId, { state: 'idle', jobs });
      state.inFlightJobs.delete(runId);
      // Explicitly refresh the run node so its icon updates when jobs change
      const run = state.runs.find((r) => String(r.id) === String(runId));
      if (run) {
        const runNode: RunNode = {
          type: 'run',
          repo,
          run
        };
        this.refresh(runNode);
      }
      // Also do a general refresh for child nodes (jobs)
      this.refresh();
    }
  }

  setRunJobsLoading(repo: RepoRef, runId: number | string): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      const existing = state.jobs.get(runId);
      state.jobs.set(runId, { state: 'loading', jobs: existing?.jobs ?? [] });
      state.inFlightJobs.delete(runId);
      // Explicitly refresh the run node so its icon updates
      const run = state.runs.find((r) => String(r.id) === String(runId));
      if (run) {
        const runNode: RunNode = {
          type: 'run',
          repo,
          run
        };
        this.refresh(runNode);
      }
      // Also do a general refresh for child nodes
      this.refresh();
    }
  }

  setRunJobsError(repo: RepoRef, runId: number | string, error: string): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.jobs.set(runId, { state: 'error', jobs: [], error });
      state.inFlightJobs.delete(runId);
      // Explicitly refresh the run node so its icon updates
      const run = state.runs.find((r) => String(r.id) === String(runId));
      if (run) {
        const runNode: RunNode = {
          type: 'run',
          repo,
          run
        };
        this.refresh(runNode);
      }
      // Also do a general refresh for child nodes
      this.refresh();
    }
  }

  clear(): void {
    this.repos.clear();
    this.configErrors = [];
    this.refresh();
  }

  setConfigErrors(errors: Array<{ message: string; action: 'configureBaseUrl' | 'setToken' }>): void {
    this.configErrors = errors;
    this.refresh();
  }

  refresh(node?: ActionsNode): void {
    if (!node) {
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }
    this.onDidChangeTreeDataEmitter.fire(node);
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
