import { WorkflowRun, Job, Step } from '../gitea/models';

export type StatusIcon = { id: string; color?: string };

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

export function statusIconForRun(run: WorkflowRun): StatusIcon {
  const status = normalizeStatus(run.status);
  const conclusion = normalizeConclusion(run.conclusion);
  if (status === 'queued') {
    return { id: 'history', color: 'charts.blue' };
  }
  if (status === 'running') {
    return { id: 'loading~spin', color: 'charts.yellow' };
  }
  switch (conclusion) {
    case 'success':
      return { id: 'check', color: 'charts.green' };
    case 'failure':
      return { id: 'error', color: 'charts.red' };
    case 'cancelled':
      return { id: 'circle-slash', color: 'descriptionForeground' };
    case 'skipped':
      return { id: 'debug-step-over', color: 'descriptionForeground' };
    case 'unknown':
    default:
      return { id: 'question', color: 'descriptionForeground' };
  }
}

export function statusIconForJob(job: Job): StatusIcon {
  const status = normalizeStatus(job.status);
  const conclusion = normalizeConclusion(job.conclusion);
  if (status === 'queued') {
    return { id: 'history', color: 'charts.blue' };
  }
  if (status === 'running') {
    return { id: 'loading~spin', color: 'charts.yellow' };
  }
  switch (conclusion) {
    case 'success':
      return { id: 'check', color: 'charts.green' };
    case 'failure':
      return { id: 'error', color: 'charts.red' };
    case 'cancelled':
      return { id: 'circle-slash', color: 'descriptionForeground' };
    case 'skipped':
      return { id: 'debug-step-over', color: 'descriptionForeground' };
    case 'unknown':
    default:
      return { id: 'question', color: 'descriptionForeground' };
  }
}

export function statusIconForStep(step: Step): StatusIcon {
  const status = normalizeStatus(step.status);
  const conclusion = normalizeConclusion(step.conclusion);
  if (status === 'queued') {
    return { id: 'history', color: 'charts.blue' };
  }
  if (status === 'running') {
    return { id: 'loading~spin', color: 'charts.yellow' };
  }
  switch (conclusion) {
    case 'success':
      return { id: 'check', color: 'charts.green' };
    case 'failure':
      return { id: 'error', color: 'charts.red' };
    case 'cancelled':
      return { id: 'circle-slash', color: 'descriptionForeground' };
    case 'skipped':
      return { id: 'debug-step-over', color: 'descriptionForeground' };
    case 'unknown':
    default:
      return { id: 'question', color: 'descriptionForeground' };
  }
}
