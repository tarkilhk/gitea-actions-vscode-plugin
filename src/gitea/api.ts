import { GiteaClient } from './client';
import { Job, RepoRef, WorkflowRun, Step } from './models';
import { normalizeConclusion, normalizeStatus } from '../util/status';

export type Secret = {
  name: string;
  description: string;
  createdAt?: string;
};

export type ActionVariable = {
  name: string;
  description: string;
  data: string;
  ownerId?: number;
  repoId?: number;
};

// Exported for testing
export function pickArray<T = unknown>(payload: unknown, fallback: T[] = []): T[] {
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

// Exported for testing
export function mapRun(repo: RepoRef, raw: unknown): WorkflowRun {
  const r = raw as Record<string, unknown>;
  const status = normalizeStatus(r.status as string | null | undefined);
  const conclusion = normalizeConclusion(r.conclusion as string | null | undefined);
  const workflowName =
    (r.workflow as { name?: string } | undefined)?.name ??
    (r.workflow_name as string | undefined) ??
    (r.workflowName as string | undefined) ??
    (r.name as string | undefined);
  const displayTitle = (r.display_title ?? r.displayTitle ?? r.title ?? r.name ?? workflowName ?? 'Workflow run') as string;
  const actorObj = r.actor as Record<string, unknown> | undefined;
  const actor =
    (actorObj?.['login'] as string | undefined) ??
    (actorObj?.['username'] as string | undefined) ??
    (actorObj?.['full_name'] as string | undefined) ??
    (r.trigger_user as string | undefined) ??
    (r.trigger_user_name as string | undefined) ??
    (r.triggerUser as string | undefined);
  const headCommit = (r.head_commit ?? r.headCommit) as { message?: string } | undefined;
  const commitMessage = (headCommit?.message ?? r.commit_message ?? r.commitMessage ?? displayTitle) as string | undefined;
  return {
    id: (r.id ?? r.run_id ?? r.workflow_id ?? String(Math.random())) as string | number,
    name: displayTitle ?? workflowName ?? 'Workflow run',
    workflowName,
    displayTitle,
    workflowPath: r.path as string | undefined,
    actor,
    commitMessage,
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

// Exported for testing
export function mapStep(raw: unknown): Step {
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

// Exported for testing
export function mapJob(raw: unknown): Job {
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

  async listWorkflows(
    repo: RepoRef
  ): Promise<{ id: string; name: string; path?: string; htmlUrl?: string; url?: string }[]> {
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/workflows`;
    const payload = await this.client.getJson<unknown>(path);
    const workflows = pickArray<unknown>(payload, (payload as { workflows?: unknown[] })?.workflows ?? []);
    return workflows
      .map((wf) => {
        const w = wf as Record<string, unknown>;
        const id = (w.id ?? w.path ?? w.name) as string | undefined;
        const name = (w.name ?? w.display_title ?? w.title ?? id) as string | undefined;
        if (!id || !name) {
          return undefined;
        }
        const result: { id: string; name: string; path?: string; htmlUrl?: string; url?: string } = {
          id,
          name
        };
        if (w.path) {
          result.path = w.path as string;
        }
        if (w.html_url) {
          result.htmlUrl = w.html_url as string;
        }
        if (w.url) {
          result.url = w.url as string;
        }
        return result;
      })
      .filter((w): w is { id: string; name: string; path?: string; htmlUrl?: string; url?: string } => w !== undefined);
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

  async getJob(repo: RepoRef, jobId: number | string, options?: { timeoutMs?: number }): Promise<Job> {
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/jobs/${jobId}`;
    const payload = await this.client.getJson<unknown>(path, undefined, options?.timeoutMs);
    return mapJob(payload);
  }

  async getJobLogs(repo: RepoRef, jobId: number | string): Promise<string> {
    return this.client.getText(`/api/v1/repos/${repo.owner}/${repo.name}/actions/jobs/${jobId}/logs`, {
      headers: {
        accept: 'text/plain, application/octet-stream'
      }
    });
  }

  async listSecrets(repo: RepoRef, page?: number, limit?: number): Promise<Secret[]> {
    const qp = new URLSearchParams();
    if (page) qp.set('page', String(page));
    if (limit) qp.set('limit', String(limit));
    const query = qp.toString();
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/secrets${query ? `?${query}` : ''}`;
    const payload = await this.client.getJson<unknown[]>(path);
    return (Array.isArray(payload) ? payload : []).map((s) => mapSecret(s));
  }

  async createOrUpdateSecret(repo: RepoRef, secretName: string, data: string, description?: string): Promise<void> {
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/secrets/${encodeURIComponent(secretName)}`;
    const res = await this.client.request(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data, description: description ?? '' })
    } as RequestInit);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }
  }

  async deleteSecret(repo: RepoRef, secretName: string): Promise<void> {
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/secrets/${encodeURIComponent(secretName)}`;
    const res = await this.client.request(path, { method: 'DELETE' } as RequestInit);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }
  }

  async listVariables(repo: RepoRef, page?: number, limit?: number): Promise<ActionVariable[]> {
    const qp = new URLSearchParams();
    if (page) qp.set('page', String(page));
    if (limit) qp.set('limit', String(limit));
    const query = qp.toString();
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/variables${query ? `?${query}` : ''}`;
    const payload = await this.client.getJson<unknown[]>(path);
    return (Array.isArray(payload) ? payload : []).map((v) => mapVariable(v));
  }

  async getVariable(repo: RepoRef, variableName: string): Promise<ActionVariable> {
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/variables/${encodeURIComponent(variableName)}`;
    const payload = await this.client.getJson<unknown>(path);
    return mapVariable(payload);
  }

  async createVariable(repo: RepoRef, variableName: string, value: string, description?: string): Promise<void> {
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/variables/${encodeURIComponent(variableName)}`;
    const res = await this.client.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, description: description ?? '' })
    } as RequestInit);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }
  }

  async updateVariable(repo: RepoRef, variableName: string, value: string, description?: string, newName?: string): Promise<void> {
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/variables/${encodeURIComponent(variableName)}`;
    const res = await this.client.request(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, description: description ?? '', name: newName ?? '' })
    } as RequestInit);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }
  }

  async deleteVariable(repo: RepoRef, variableName: string): Promise<void> {
    const path = `/api/v1/repos/${repo.owner}/${repo.name}/actions/variables/${encodeURIComponent(variableName)}`;
    const res = await this.client.request(path, { method: 'DELETE' } as RequestInit);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }
  }
}

function mapSecret(raw: unknown): Secret {
  const r = raw as Record<string, unknown>;
  return {
    name: (r.name as string) ?? '',
    description: (r.description as string) ?? '',
    createdAt: (r.created_at as string) ?? (r.createdAt as string)
  };
}

function mapVariable(raw: unknown): ActionVariable {
  const r = raw as Record<string, unknown>;
  return {
    name: (r.name as string) ?? '',
    description: (r.description as string) ?? '',
    data: (r.data as string) ?? (r.value as string) ?? '',
    ownerId: (r.owner_id as number | undefined) ?? (r.ownerId as number | undefined),
    repoId: (r.repo_id as number | undefined) ?? (r.repoId as number | undefined)
  };
}
