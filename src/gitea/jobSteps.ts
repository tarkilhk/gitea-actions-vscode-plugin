import { Job } from './models';
import { supportsOfficialJobSteps } from '../util/version';

/**
 * Whether the official jobs payload already included a `steps` field.
 *
 * Gitea 1.26+ sends `steps: []` or `steps: [...]`. Older servers sent `null`,
 * which `mapJob` stores as `undefined`. That distinction is the seam between
 * the official happy path and the legacy getJob / web-UI fallbacks.
 */
export function hasOfficialSteps(job: Pick<Job, 'steps'>): boolean {
  return job.steps !== undefined;
}

export function jobsMissingOfficialSteps(jobs: Job[]): Job[] {
  return jobs.filter((job) => !hasOfficialSteps(job) && !job.stepsError);
}

/**
 * True when we still need the pre-1.26 workarounds (per-job GET and the
 * undocumented web UI endpoint).
 *
 * Unknown / unparseable versions take the old path. We never assume the
 * user's Gitea is current just because this machine is.
 *
 * Gitea 1.26+ populates steps on listJobs (#36603). Missing steps there means
 * the job has none yet, not that we should scrape the web UI.
 */
export function shouldUseLegacyStepFallback(
  serverVersion: string | null | undefined,
  jobs: Job[]
): boolean {
  if (supportsOfficialJobSteps(serverVersion)) {
    return false;
  }
  return jobsMissingOfficialSteps(jobs).length > 0;
}
