import { WorkflowRun, Job, Step } from '../gitea/models';

export type NormalizedStatus = 'queued' | 'running' | 'completed' | 'unknown';
export type NormalizedConclusion = 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';

export function normalizeStatus(value?: string | null): NormalizedStatus {
  const lower = (value ?? '').toLowerCase();
  if (lower === 'queued' || lower === 'waiting') {
    return 'queued';
  }
  if (lower === 'in_progress' || lower === 'running' || lower === 'progress') {
    return 'running';
  }
  if (lower === 'completed' || lower === 'finished') {
    return 'completed';
  }
  return 'unknown';
}

export function normalizeConclusion(value?: string | null): NormalizedConclusion | undefined {
  const lower = (value ?? '').toLowerCase();
  if (!lower) {
    return undefined;
  }
  if (['success', 'passed', 'ok'].includes(lower)) {
    return 'success';
  }
  if (['failure', 'failed', 'error'].includes(lower)) {
    return 'failure';
  }
  if (['cancelled', 'canceled', 'stopped'].includes(lower)) {
    return 'cancelled';
  }
  if (['skipped', 'skip'].includes(lower)) {
    return 'skipped';
  }
  return 'unknown';
}

export function statusIconForRun(run: WorkflowRun): string {
  const status = normalizeStatus(run.status);
  const conclusion = normalizeConclusion(run.conclusion);
  if (status === 'queued') {
    return '$(history)';
  }
  if (status === 'running') {
    return '$(loading~spin)';
  }
  switch (conclusion) {
    case 'success':
      return '$(check)';
    case 'failure':
      return '$(error)';
    case 'cancelled':
      return '$(circle-slash)';
    case 'skipped':
      return '$(debug-step-over)';
    case 'unknown':
    default:
      return '$(question)';
  }
}

export function statusIconForJob(job: Job): string {
  const status = normalizeStatus(job.status);
  const conclusion = normalizeConclusion(job.conclusion);
  if (status === 'queued') {
    return '$(history)';
  }
  if (status === 'running') {
    return '$(loading~spin)';
  }
  switch (conclusion) {
    case 'success':
      return '$(check)';
    case 'failure':
      return '$(error)';
    case 'cancelled':
      return '$(circle-slash)';
    case 'skipped':
      return '$(debug-step-over)';
    case 'unknown':
    default:
      return '$(question)';
  }
}

export function statusIconForStep(step: Step): string {
  const status = normalizeStatus(step.status);
  const conclusion = normalizeConclusion(step.conclusion);
  if (status === 'queued') {
    return '$(history)';
  }
  if (status === 'running') {
    return '$(loading~spin)';
  }
  switch (conclusion) {
    case 'success':
      return '$(check)';
    case 'failure':
      return '$(error)';
    case 'cancelled':
      return '$(circle-slash)';
    case 'skipped':
      return '$(debug-step-over)';
    case 'unknown':
    default:
      return '$(question)';
  }
}
