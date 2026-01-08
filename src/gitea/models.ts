export type RepoRef = {
  host: string;
  owner: string;
  name: string;
  htmlUrl?: string;
};

export type WorkflowRun = {
  id: number | string;
  name: string;
  branch?: string;
  sha?: string;
  status: 'queued' | 'running' | 'completed' | 'unknown';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';
  createdAt?: string;
  updatedAt?: string;
  htmlUrl?: string;
};

export type Job = {
  id: number | string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'unknown';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';
  startedAt?: string;
  completedAt?: string;
  htmlUrl?: string;
};

export type PinnedRepo = {
  owner: string;
  name: string;
};
