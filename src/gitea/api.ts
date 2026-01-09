import { GiteaClient } from './client';
import { Job, RepoRef, WorkflowRun, Step } from './models';
import { normalizeConclusion, normalizeStatus } from '../util/status';

function pickArray<T = unknown>(payload: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const obj = payload as { data?: unknown[]; workflow_runs?: unknown[] };
  if (Array.isArray(obj?.data)) {
    return obj.data as T[];
  }
  if (Array.isArray(obj?.workflow_runs)) {
    return obj.workflow_runs as T[];
  }
  return fallback;
}

function mapRun(repo: RepoRef, raw: unknown): WorkflowRun {
  const r = raw as Record<string, unknown>;
  const status = normalizeStatus(r.status as string | null | undefined);
  const conclusion = normalizeConclusion(r.conclusion as string | null | undefined);
  return {
    id: (r.id ?? r.run_id ?? r.workflow_id ?? String(Math.random())) as string | number,
    name: (r.display_title ?? r.title ?? r.name ?? r.workflow_name ?? `${repo.owner}/${repo.name}`) as string,
    runNumber: (r.run_number ?? r.runNumber) as number | undefined,
    runAttempt: (r.run_attempt ?? r.runAttempt) as number | undefined,
    event: r.event as string | undefined,
    branch: (r.head_branch ?? r.branch ?? r.ref) as string | undefined,
    sha: (r.head_sha ?? r.sha ?? r.commit) as string | undefined,
    status,
    conclusion,
    createdAt: (r.created_at ?? r.created ?? r.createdAt) as string | undefined,
    updatedAt: (r.updated_at ?? r.updated ?? r.updatedAt) as string | undefined,
    startedAt: (r.started_at ?? r.startedAt) as string | undefined,
    completedAt: (r.completed_at ?? r.completedAt) as string | undefined,
    htmlUrl: (r.html_url ?? r.url ?? r.web_url) as string | undefined
  };
}

function mapStep(raw: unknown): Step {
  const r = raw as Record<string, unknown>;
  const status = normalizeStatus(r.status as string | null | undefined);
  const conclusion = normalizeConclusion(r.conclusion as string | null | undefined);
  return {
    id: (r.id ?? r.number ?? r.step_id) as string | number | undefined,
    name: (r.name ?? r.title ?? 'Step') as string,
    status,
    conclusion,
    startedAt: (r.started_at ?? r.start_time ?? r.startedAt) as string | undefined,
    completedAt: (r.completed_at ?? r.completedAt ?? r.completed) as string | undefined,
    number: (r.number ?? r.step_number) as number | undefined
  };
}

function mapJob(raw: unknown): Job {
  const r = raw as Record<string, unknown>;
  const status = normalizeStatus(r.status as string | null | undefined);
  const conclusion = normalizeConclusion(r.conclusion as string | null | undefined);
  return {
    id: (r.id ?? r.job_id ?? String(Math.random())) as string | number,
    name: (r.name ?? r.title ?? 'Job') as string,
    status,
    conclusion,
    startedAt: (r.started_at ?? r.start_time ?? r.startedAt) as string | undefined,
    completedAt: (r.completed_at ?? r.completed ?? r.completedAt) as string | undefined,
    htmlUrl: (r.html_url ?? r.url ?? r.web_url) as string | undefined,
    steps: Array.isArray(r.steps) ? (r.steps as unknown[]).map((step) => mapStep(step)) : undefined
  };
}

export class GiteaApi {
  constructor(private readonly client: GiteaClient) {}

  async testConnection(): Promise<string> {
    const response = await this.client.getJson<{ version?: string }>('/api/v1/version');
    return response.version ?? 'unknown';
  }

  async listAccessibleRepos(limit = 50): Promise<{ owner: string; name: string; htmlUrl?: string }[]> {
    const payload = await this.client.getJson<unknown>(`/api/v1/user/repos?limit=${limit}`);
    const repos = pickArray<unknown>(payload, (payload as { repos?: unknown[] })?.repos ?? []);
    return repos
      .map((repo) => {
        const r = repo as Record<string, unknown>;
        const owner = (r.owner as { login?: string; username?: string } | undefined)?.login ?? 
                     (r.owner as { login?: string; username?: string } | undefined)?.username ?? 
                     (r.owner as string | undefined) ?? 
                     (r.namespace as string | undefined);
        return {
          owner: owner ?? '',
          name: (r.name as string | undefined) ?? '',
          htmlUrl: (r.html_url ?? r.clone_url ?? r.ssh_url) as string | undefined
        };
      })
      .filter((r) => r.owner && r.name);
  }

  async listRuns(repo: RepoRef, limit: number): Promise<WorkflowRun[]> {
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/runs?limit=${encodeURIComponent(
      limit
    )}`;
    const payload = await this.client.getJson<unknown>(path);
    const runs = pickArray<unknown>(payload, []);
    return runs.map((run) => mapRun(repo, run));
  }

  async listJobs(
    repo: RepoRef,
    runId: number | string,
    options?: { limit?: number; timeoutMs?: number }
  ): Promise<Job[]> {
    const qp = options?.limit && Number.isFinite(options.limit) ? `?limit=${encodeURIComponent(options.limit)}` : '';
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/runs/${runId}/jobs${qp}`;
    const payload = await this.client.getJson<unknown>(path, undefined, options?.timeoutMs);
    const jobs = pickArray<unknown>(payload, (payload as { jobs?: unknown[] })?.jobs ?? []);
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
