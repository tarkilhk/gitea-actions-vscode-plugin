import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { GiteaClient } from '../gitea/client';
import { GiteaInternalApi } from '../gitea/internalApi';
import { RepoRef, RunRef, WorkflowRun, toRunRef } from '../gitea/models';
import { getSettings } from '../config/settings';
import { ActionsNode } from '../views/nodes';
import { getOutputChannel } from '../util/logging';

type DiagnoseContext = {
  getConfigError: () => Promise<string | undefined>;
  ensureApi: () => Promise<GiteaApi | undefined>;
  ensureInternalApi: () => Promise<GiteaInternalApi | undefined>;
  getToken: () => Promise<string | undefined>;
};

function isHtmlLoginPage(html: string): boolean {
  const s = html.toLowerCase();
  return (
    s.includes('href="/user/login"') ||
    s.includes('action="/user/login"') ||
    s.includes('name="user_name"') ||
    s.includes('name="password"') ||
    s.includes('<title>sign in') ||
    s.includes('<title>login')
  );
}

async function pickRun(api: GiteaApi, repo: RepoRef): Promise<WorkflowRun | undefined> {
  const runs = await api.listRuns(repo, 20);
  if (!runs.length) {
    vscode.window.showInformationMessage(`No workflow runs found for ${repo.owner}/${repo.name}.`);
    return undefined;
  }

  const items = runs.map((r) => {
    const idPart = r.runNumber ?? r.id;
    return {
      label: `${r.workflowName ?? r.displayTitle ?? r.name} #${idPart}`,
      description: `${r.status}${r.conclusion ? ` (${r.conclusion})` : ''}`,
      detail: `id=${r.id}${r.runNumber != null ? ` run_number=${r.runNumber}` : ''}`,
      run: r
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: `Diagnose steps: pick a run for ${repo.owner}/${repo.name}`,
    ignoreFocusOut: true
  });
  return picked?.run;
}

async function resolveTarget(node: ActionsNode | undefined, ctx: DiagnoseContext): Promise<{ repo: RepoRef; runRef: RunRef } | undefined> {
  const api = await ctx.ensureApi();
  if (!api) return undefined;

  // If invoked from a node, prefer that context.
  if (node?.type === 'job' || node?.type === 'step') {
    return { repo: node.runRef.repo, runRef: node.runRef };
  }
  if (node?.type === 'run') {
    return { repo: node.repo, runRef: toRunRef(node.repo, node.run) };
  }
  if (node?.type === 'repo') {
    const run = await pickRun(api, node.repo);
    if (!run) return undefined;
    return { repo: node.repo, runRef: toRunRef(node.repo, run) };
  }
  if (node?.type === 'workflowGroup') {
    const run = await pickRun(api, node.repo);
    if (!run) return undefined;
    return { repo: node.repo, runRef: toRunRef(node.repo, run) };
  }

  // Command palette invocation: ask for owner/repo and then pick a run.
  const ownerRepo = await vscode.window.showInputBox({
    title: 'Diagnose steps',
    prompt: 'Enter repository as owner/name',
    placeHolder: 'tarkil/homelab-infra',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const v = value.trim();
      if (!v) return 'Required';
      if (!v.includes('/')) return 'Expected owner/name';
      return undefined;
    }
  });
  if (!ownerRepo) return undefined;

  const [owner, name] = ownerRepo.trim().split('/', 2);
  const settings = getSettings();
  let host = '';
  try {
    host = new URL(settings.baseUrl).host;
  } catch {
    host = '';
  }
  const repo: RepoRef = { host, owner, name };
  const run = await pickRun(api, repo);
  if (!run) return undefined;
  return { repo, runRef: toRunRef(repo, run) };
}

async function probeActionsRunPage(client: GiteaClient, repo: RepoRef, runId: number | string): Promise<{ status: number; note: string }> {
  const path = `/${repo.owner}/${repo.name}/actions/runs/${runId}`;
  const res = await client.request(path, { method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } } as RequestInit);
  const ct = res.headers.get('content-type') ?? '';
  let note = `content-type=${ct || 'unknown'}`;
  try {
    // Only sample small prefix; enough to detect login forms/redirect pages.
    const text = (await res.text()).slice(0, 8192);
    if (ct.includes('text/html') && isHtmlLoginPage(text)) {
      note += '; looks like login page HTML';
    }
    if (text.toLowerCase().includes('csrf')) {
      note += '; contains csrf';
    }
  } catch {
    // ignore read errors
  }
  return { status: res.status, note };
}

export async function diagnoseSteps(node: ActionsNode | undefined, ctx: DiagnoseContext): Promise<void> {
  const cfgError = await ctx.getConfigError();
  if (cfgError) {
    vscode.window.showWarningMessage(`Cannot diagnose steps; ${cfgError.toLowerCase()} first.`);
    return;
  }

  const api = await ctx.ensureApi();
  const internalApi = await ctx.ensureInternalApi();
  if (!api || !internalApi) {
    vscode.window.showErrorMessage('Failed to initialize API client.');
    return;
  }

  const target = await resolveTarget(node, ctx);
  if (!target) return;
  const { repo, runRef } = target;

  const settings = getSettings();
  const token = await ctx.getToken();
  if (!token) {
    vscode.window.showWarningMessage('No token configured.');
    return;
  }

  const channel = getOutputChannel();
  channel.show(true);

  channel.appendLine('==============================');
  channel.appendLine('Gitea Actions: Diagnose Steps');
  channel.appendLine('==============================');
  channel.appendLine(`baseUrl: ${settings.baseUrl}`);
  channel.appendLine(`repo: ${repo.owner}/${repo.name}`);
  channel.appendLine(`run: id=${runRef.id}${runRef.runNumber != null ? ` run_number=${runRef.runNumber}` : ''}`);

  // Probe version and repo metadata (private/public)
  try {
    const version = await api.testConnection();
    channel.appendLine(`gitea version (api/v1/version): ${version}`);
  } catch (e) {
    channel.appendLine(`gitea version (api/v1/version): ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  const diagClient = new GiteaClient({
    baseUrl: settings.baseUrl,
    token,
    insecureSkipVerify: settings.insecureSkipVerify
  });

  try {
    const repoMeta = await diagClient.getJson<{ private?: boolean; permissions?: unknown } & Record<string, unknown>>(
      `/api/v1/repos/${repo.owner}/${repo.name}`
    );
    channel.appendLine(`repo.private: ${String(!!repoMeta.private)}`);
    const defaultBranch = typeof repoMeta['default_branch'] === 'string' ? repoMeta['default_branch'] : undefined;
    if (defaultBranch) channel.appendLine(`repo.default_branch: ${defaultBranch}`);
  } catch (e) {
    channel.appendLine(`repo metadata: ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Probe web UI run page to see whether it is reachable / login-gated.
  try {
    const p1 = await probeActionsRunPage(diagClient, repo, runRef.id);
    channel.appendLine(`GET /{owner}/{repo}/actions/runs/${runRef.id}: ${p1.status} (${p1.note})`);
  } catch (e) {
    channel.appendLine(`GET actions run page (id): ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (runRef.runNumber != null && String(runRef.runNumber) !== String(runRef.id)) {
    try {
      const p2 = await probeActionsRunPage(diagClient, repo, runRef.runNumber);
      channel.appendLine(`GET /{owner}/{repo}/actions/runs/${runRef.runNumber}: ${p2.status} (${p2.note})`);
    } catch (e) {
      channel.appendLine(`GET actions run page (run_number): ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Jobs + steps comparison
  let jobs: Array<{ id: number | string; name: string; status?: string }> = [];
  try {
    const listed = await api.listJobs(repo, runRef.id, { limit: 50 });
    jobs = listed.map((j) => ({ id: j.id, name: j.name, status: j.status }));
    channel.appendLine(`listJobs: ${jobs.length} job(s)`);
  } catch (e) {
    channel.appendLine(`listJobs: ERROR: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
    const j = jobs[jobIndex];
    channel.appendLine('------------------------------');
    channel.appendLine(`job[${jobIndex}]: ${j.name} (id=${j.id}, status=${j.status ?? 'unknown'})`);

    // Official: GET /actions/jobs/{job_id}
    try {
      const full = await api.getJob(repo, j.id);
      const n = full.steps?.length ?? 0;
      channel.appendLine(`official GET /api/v1/.../actions/jobs/${j.id}: steps=${n}${full.steps == null ? ' (null/undefined)' : ''}`);
    } catch (e) {
      channel.appendLine(`official getJob: ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Internal UI: POST /{owner}/{repo}/actions/runs/{run}/jobs/{jobIndex}
    const tryInternal = async (runId: number | string): Promise<{ ok: boolean; steps?: number; err?: string }> => {
      try {
        const r = await internalApi.getJobWithSteps(repo, runId, jobIndex);
        return { ok: true, steps: r.steps?.length ?? 0 };
      } catch (e) {
        return { ok: false, err: e instanceof Error ? e.message : String(e) };
      }
    };

    const internal = await tryInternal(runRef.id);
    if (!internal.ok && internal.err?.includes('404') && runRef.runNumber != null && String(runRef.runNumber) !== String(runRef.id)) {
      const retry = await tryInternal(runRef.runNumber);
      channel.appendLine(`internal POST .../actions/runs/${runRef.id}/jobs/${jobIndex}: ERROR: ${internal.err}`);
      channel.appendLine(`internal POST .../actions/runs/${runRef.runNumber}/jobs/${jobIndex}: ${retry.ok ? `steps=${retry.steps}` : `ERROR: ${retry.err}`}`);
    } else {
      channel.appendLine(
        `internal POST .../actions/runs/${runRef.id}/jobs/${jobIndex}: ${internal.ok ? `steps=${internal.steps}` : `ERROR: ${internal.err}`}`
      );
    }
  }

  channel.appendLine('==============================');
  channel.appendLine('Interpretation hints:');
  channel.appendLine('- If official steps is null/0 AND internal returns 401/404 or login HTML, steps are session-gated in Gitea web UI for this repo.');
  channel.appendLine('- If repo.private is true, that strongly correlates with web UI gating unless you have browser cookies.');
}
