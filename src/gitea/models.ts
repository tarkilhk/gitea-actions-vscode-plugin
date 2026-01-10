export type RepoRef = {
  host: string;
  owner: string;
  name: string;
  htmlUrl?: string;
};

export type WorkflowRun = {
  id: number | string;
  name: string;
  workflowName?: string;
  displayTitle?: string;
  workflowPath?: string;
  actor?: string;
  commitMessage?: string;
  runNumber?: number;
  runAttempt?: number;
  event?: string;
  branch?: string;
  sha?: string;
  status: 'queued' | 'running' | 'completed' | 'unknown';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  htmlUrl?: string;
};

export type Step = {
  id?: number | string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'unknown';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';
  startedAt?: string;
  completedAt?: string;
  number?: number;
};

export type Job = {
  id: number | string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'unknown';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';
  startedAt?: string;
  completedAt?: string;
  htmlUrl?: string;
  steps?: Step[];
};
