import { fetch } from 'undici';

const baseUrl = (process.env.GITEA_URL ?? '').replace(/\/+$/, '');
const token = process.env.GITEA_TOKEN ?? '';
const repo = process.env.GITEA_REPO ?? '';
const [owner, name] = repo.split('/');

if (!baseUrl || !token || !owner || !name) {
  console.error('Set GITEA_URL, GITEA_TOKEN, and GITEA_REPO (owner/name).');
  process.exit(1);
}

async function get(path, { timeoutMs = 20000, accept = 'application/json' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { authorization: `token ${token}`, accept },
      signal: controller.signal
    });
    const text = await res.text();
    return { status: res.status, ms: Date.now() - started, text };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const version = await get('/api/v1/version');
console.log(`version status=${version.status} ms=${version.ms} body=${version.text}`);

const runs = await get(`/api/v1/repos/${owner}/${name}/actions/runs?limit=5`);
const runsJson = parseJson(runs.text);
const runList = Array.isArray(runsJson?.workflow_runs)
  ? runsJson.workflow_runs
  : Array.isArray(runsJson)
    ? runsJson
    : [];
console.log(`runs status=${runs.status} ms=${runs.ms} count=${runList.length}`);
if (!runList.length) {
  console.error('No workflow runs found.');
  process.exit(1);
}

const run = runList[0];
console.log(`using run id=${run.id} status=${run.status} conclusion=${run.conclusion ?? ''} title=${run.display_title ?? run.name ?? ''}`);

const jobs4s = await get(`/api/v1/repos/${owner}/${name}/actions/runs/${run.id}/jobs?limit=10`, {
  timeoutMs: 4000
}).catch((error) => ({ status: 0, ms: 4000, text: String(error) }));
console.log(`jobs@4s status=${jobs4s.status} ms=${jobs4s.ms} preview=${jobs4s.text.slice(0, 180)}`);

const jobs15s = await get(`/api/v1/repos/${owner}/${name}/actions/runs/${run.id}/jobs?limit=10`, {
  timeoutMs: 15000
});
const jobsJson = parseJson(jobs15s.text);
const jobList = Array.isArray(jobsJson?.jobs) ? jobsJson.jobs : Array.isArray(jobsJson) ? jobsJson : [];
console.log(`jobs@15s status=${jobs15s.status} ms=${jobs15s.ms} count=${jobList.length}`);
for (const job of jobList) {
  const steps = Array.isArray(job.steps) ? job.steps : job.steps === null ? 'null' : typeof job.steps;
  const stepNames = Array.isArray(job.steps) ? job.steps.map((s) => s.name).join(', ') : '';
  console.log(`  job id=${job.id} name=${job.name} status=${job.status} steps=${Array.isArray(job.steps) ? job.steps.length : steps} ${stepNames}`);
}

if (!jobList.length) {
  console.error('No jobs on the selected run.');
  process.exit(1);
}

const job = jobList[0];
const logs = await get(`/api/v1/repos/${owner}/${name}/actions/jobs/${job.id}/logs`, {
  timeoutMs: 20000,
  accept: 'text/plain, application/octet-stream'
});
console.log(`logs status=${logs.status} ms=${logs.ms} bytes=${logs.text.length} aborted=${/This operation was aborted/i.test(logs.text)}`);
console.log(logs.text.slice(0, 400));
