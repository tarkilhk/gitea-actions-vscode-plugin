import { GiteaClient } from './client';
import { Job, RepoRef, WorkflowRun } from './models';
import { normalizeConclusion, normalizeStatus } from '../util/status';

function pickArray<T = unknown>(payload: any, fallback: T[] = []): T[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.workflow_runs)) {
    return payload.workflow_runs;
  }
  return fallback;
}

function mapRun(repo: RepoRef, raw: any): WorkflowRun {
  const status = normalizeStatus(raw.status);
  const conclusion = normalizeConclusion(raw.conclusion);
  return {
    id: raw.id ?? raw.run_id ?? raw.workflow_id ?? String(Math.random()),
    name: raw.display_title ?? raw.title ?? raw.name ?? raw.workflow_name ?? `${repo.owner}/${repo.name}`,
    runNumber: raw.run_number ?? raw.runNumber,
    runAttempt: raw.run_attempt ?? raw.runAttempt,
    event: raw.event,
    branch: raw.head_branch ?? raw.branch ?? raw.ref,
    sha: raw.head_sha ?? raw.sha ?? raw.commit,
    status,
    conclusion,
    createdAt: raw.created_at ?? raw.created ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updated ?? raw.updatedAt,
    startedAt: raw.started_at ?? raw.startedAt,
    completedAt: raw.completed_at ?? raw.completedAt,
    htmlUrl: raw.html_url ?? raw.url ?? raw.web_url
  };
}

function mapJob(raw: any): Job {
  const status = normalizeStatus(raw.status);
  const conclusion = normalizeConclusion(raw.conclusion);
  return {
    id: raw.id ?? raw.job_id ?? String(Math.random()),
    name: raw.name ?? raw.title ?? 'Job',
    status,
    conclusion,
    startedAt: raw.started_at ?? raw.start_time ?? raw.startedAt,
    completedAt: raw.completed_at ?? raw.completed ?? raw.completedAt,
    htmlUrl: raw.html_url ?? raw.url ?? raw.web_url
  };
}

export class GiteaApi {
  constructor(private readonly client: GiteaClient) {}

  async testConnection(): Promise<string> {
    const response = await this.client.getJson<{ version?: string }>('/api/v1/version');
    return response.version ?? 'unknown';
  }

  async listAccessibleRepos(limit = 50): Promise<{ owner: string; name: string; htmlUrl?: string }[]> {
    const payload = await this.client.getJson<any>(`/api/v1/user/repos?limit=${limit}`);
    const repos = pickArray<any>(payload, payload.repos ?? []);
    return repos
      .map((repo) => ({
        owner: repo.owner?.login ?? repo.owner?.username ?? repo.owner ?? repo.namespace,
        name: repo.name,
        htmlUrl: repo.html_url ?? repo.clone_url ?? repo.ssh_url
      }))
      .filter((r) => r.owner && r.name);
  }

  async listRuns(repo: RepoRef, limit: number): Promise<WorkflowRun[]> {
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/runs?limit=${encodeURIComponent(
      limit
    )}`;
    const payload = await this.client.getJson<any>(path);
    const runs = pickArray<any>(payload, []);
    return runs.map((run) => mapRun(repo, run));
  }

  async listJobs(
    repo: RepoRef,
    runId: number | string,
    options?: { limit?: number; timeoutMs?: number }
  ): Promise<Job[]> {
    const qp = options?.limit && Number.isFinite(options.limit) ? `?limit=${encodeURIComponent(options.limit)}` : '';
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/runs/${runId}/jobs${qp}`;
    const payload = await this.client.getJson<any>(path, undefined, options?.timeoutMs);
    const jobs = pickArray<any>(payload, payload.jobs ?? []);
    return jobs.map((job) => mapJob(job));
  }

  async getJobLogs(repo: RepoRef, jobId: number | string): Promise<string> {
    return this.client.getText(`/api/v1/repos/${repo.owner}/${repo.name}/actions/jobs/${jobId}/logs`, {
      headers: {
        accept: 'text/plain, application/octet-stream'
      }
    });
  }
}
