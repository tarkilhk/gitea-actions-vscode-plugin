export type RepoRef = {
  host: string;
  owner: string;
  name: string;
  htmlUrl?: string;
};

/**
 * Reference to a workflow run with all identifiers needed for API calls.
 * 
 * - `id`: Database ID used by the official Gitea API
 * - `runNumber`: URL path number used by the internal/undocumented API
 * 
 * The internal API uses run number in URL paths (e.g., /actions/runs/540),
 * while the official API uses the database ID (e.g., /actions/runs/639/jobs).
 */
export type RunRef = {
  repo: RepoRef;
  /** Database ID - used by official Gitea API endpoints */
  id: number | string;
  /** Run number as shown in URL - used by internal API endpoints */
  runNumber?: number;
};

/**
 * Creates a RunRef from a WorkflowRun and RepoRef.
 */
export function toRunRef(repo: RepoRef, run: WorkflowRun): RunRef {
  return {
    repo,
    id: run.id,
    runNumber: run.runNumber
  };
}

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
  /** Duration string from internal API (e.g., "1s", "35s") */
  duration?: string;
  /** Step index (0-based) for internal API calls */
  stepIndex?: number;
};

/**
 * Log line from the internal Gitea API.
 */
export type StepLogLine = {
  index: number;
  message: string;
  timestamp: number;
};

/**
 * Log data for a single step from the internal API.
 */
export type StepLog = {
  step: number;
  cursor: number | null;
  lines: StepLogLine[];
  started?: number;
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
  /**
   * Error message when steps could not be loaded.
   * Set when Gitea's internal API returns 404/401 (session-gated).
   */
  stepsError?: string;
};
