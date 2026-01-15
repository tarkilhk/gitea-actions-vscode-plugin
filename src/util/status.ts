export type StatusIcon = { id: string; color?: string };

export type NormalizedStatus = 'queued' | 'running' | 'completed' | 'unknown';
export type NormalizedConclusion = 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';

/**
 * Interface for objects that have status and conclusion fields.
 */
export type HasStatusConclusion = {
  status?: string;
  conclusion?: string;
};

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

/**
 * Returns the appropriate status icon for any item with status and conclusion.
 * Works for WorkflowRun, Job, and Step objects.
 */
export function statusIcon(item: HasStatusConclusion): StatusIcon {
  const status = normalizeStatus(item.status);
  const conclusion = normalizeConclusion(item.conclusion);
  
  if (status === 'queued') {
    return { id: 'hourglass', color: 'charts.blue' };
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

// Backward compatibility aliases - delegates to the unified statusIcon function
export const statusIconForRun = statusIcon;
export const statusIconForJob = statusIcon;
export const statusIconForStep = statusIcon;
