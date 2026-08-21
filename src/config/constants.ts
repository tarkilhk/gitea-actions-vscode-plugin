/**
 * Centralized constants for the Gitea Actions extension.
 * These values control timing behavior throughout the extension.
 */

/**
 * Timeout for job API requests in milliseconds.
 *
 * Gitea 1.27+ populates `steps` on GET .../actions/runs/{run}/jobs and
 * batch-loads related job/task data, so this endpoint is slower than the
 * run list. A 4s cap aborts with "This operation was aborted" before the
 * payload arrives. Keep this aligned with the default client timeout.
 */
export const JOBS_TIMEOUT_MS = 15000;

/** Duration for toast/notification messages (ms) */
export const TOAST_TIMEOUT_MS = 3000;

/** Maximum concurrent workers for parallel operations */
export const MAX_CONCURRENT_REPOS = 4;

/** Maximum concurrent workers for job fetching */
export const MAX_CONCURRENT_JOBS = 3;
