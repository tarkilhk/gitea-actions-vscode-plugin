import * as vscode from 'vscode';
import { ActionsNode, MessageNode, RepoNode, RunNode, JobNode, toTreeItem } from './nodes';
import { RepoRef, WorkflowRun, Job } from '../gitea/models';

type RepoKey = string;

type RepoState = {
  repo: RepoRef;
  pinned: boolean;
  runs: WorkflowRun[];
  jobs: Map<string | number, Job[]>;
  state: 'idle' | 'loading' | 'error';
  error?: string;
};

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionsNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ActionsNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly repos = new Map<RepoKey, RepoState>();

  getTreeItem(element: ActionsNode): vscode.TreeItem {
    return toTreeItem(element);
  }

  getChildren(element?: ActionsNode): vscode.ProviderResult<ActionsNode[]> {
    if (!element) {
      if (!this.repos.size) {
        const message: MessageNode = {
          type: 'message',
          message: 'No repositories found. Configure base URL and open a Gitea repo.',
          severity: 'info'
        };
        return [message];
      }
      return Array.from(this.repos.values()).map<RepoNode>((state) => ({
        type: 'repo',
        repo: state.repo,
        pinned: state.pinned,
        state: state.state,
        error: state.error,
        hasRuns: state.runs.length > 0
      }));
    }

    if (element.type === 'repo') {
      const repoState = this.repos.get(repoKey(element.repo));
      if (!repoState) {
        return [];
      }
      if (repoState.state === 'error') {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: repoState.error ?? 'Failed to load runs',
            severity: 'error'
          } satisfies MessageNode
        ];
      }
      if (!repoState.runs.length && repoState.state !== 'loading') {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: 'No runs found',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      return repoState.runs.map<RunNode>((run) => ({
        type: 'run',
        repo: repoState.repo,
        run
      }));
    }

    if (element.type === 'run') {
      const repoState = this.repos.get(repoKey(element.repo));
      if (!repoState) {
        return [];
      }
      const jobs = repoState.jobs.get(element.run.id) ?? [];
      if (!jobs.length) {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: 'No jobs yet',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      return jobs.map<JobNode>((job) => ({
        type: 'job',
        repo: element.repo,
        runId: element.run.id,
        job
      }));
    }

    return [];
  }

  setRepositories(repos: RepoRef[], pinnedIds: Set<string>): void {
    const next = new Map<RepoKey, RepoState>();
    for (const repo of repos) {
      const key = repoKey(repo);
      const existing = this.repos.get(key);
      next.set(key, {
        repo,
        pinned: pinnedIds.has(key),
        runs: existing?.runs ?? [],
        jobs: existing?.jobs ?? new Map(),
        state: existing?.state ?? 'idle',
        error: existing?.error
      });
    }
    this.repos.clear();
    next.forEach((value, key) => this.repos.set(key, value));
    this.refresh();
  }

  setRepoLoading(repo: RepoRef): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.state = 'loading';
      state.error = undefined;
      this.refresh(repo);
    }
  }

  setRepoError(repo: RepoRef, error: string): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.state = 'error';
      state.error = error;
      this.refresh(repo);
    }
  }

  updateRuns(repo: RepoRef, runs: WorkflowRun[]): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.runs = runs;
      state.state = 'idle';
      state.error = undefined;
      this.refresh(repo);
    }
  }

  updateJobs(repo: RepoRef, runId: number | string, jobs: Job[]): void {
    const state = this.repos.get(repoKey(repo));
    if (state) {
      state.jobs.set(runId, jobs);
      this.refresh(repo);
    }
  }

  clear(): void {
    this.repos.clear();
    this.refresh();
  }

  refresh(node?: ActionsNode | RepoRef): void {
    if (!node) {
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }
    if ('type' in (node as any)) {
      this.onDidChangeTreeDataEmitter.fire(node as ActionsNode);
    } else {
      const repo = node as RepoRef;
      this.onDidChangeTreeDataEmitter.fire({
        type: 'repo',
        repo,
        pinned: false,
        state: 'idle',
        hasRuns: false
      } satisfies RepoNode);
    }
  }
}

function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}
