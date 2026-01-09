/**
 * Centralized constants for the Gitea Actions extension.
 * These values control timing behavior throughout the extension.
 */

/** Timeout for job API requests in milliseconds */
export const JOBS_TIMEOUT_MS = 4000;

/** Interval between log polling requests when streaming live logs (ms) */
export const LOG_POLL_INTERVAL_MS = 2000;

/** Delay before refreshing jobs for active runs (ms) */
export const JOB_REFRESH_DELAY_MS = 3000;

/** Duration for toast/notification messages (ms) */
export const TOAST_TIMEOUT_MS = 3000;

/** Maximum concurrent workers for parallel operations */
export const MAX_CONCURRENT_REPOS = 4;

/** Maximum concurrent workers for job fetching */
export const MAX_CONCURRENT_JOBS = 3;
