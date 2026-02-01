/**
 * Internal (undocumented) Gitea API for steps and logs.
 *
 * BACKGROUND:
 * Gitea's official API has a `steps` field on jobs but has never implemented
 * populating it (always returns null). This module provides a workaround by
 * calling the same internal endpoints the Gitea web UI uses.
 *
 * CURRENT STATUS (as of Gitea ≈1.24+):
 * Recent Gitea versions gated these endpoints behind browser session cookies
 * (e.g. `gitea_incredible`, `_csrf`). With only a PAT we get 404.
 *
 * This worked on Gitea ≈1.23 and earlier. We still try because:
 * 1. Older Gitea instances may still allow PAT access.
 * 2. A future Gitea version might re-enable token access or populate the
 *    official API `steps` field.
 *
 * When steps fail to load, refreshService.ts sets job.stepsError for the UI.
 */

import { GiteaClient } from './client';
import { RepoRef, Step, StepLog } from './models';
import { normalizeConclusion, normalizeStatus } from '../util/status';
import { logDebug, logWarn } from '../util/logging';

const CONTENT_TYPE_HEADER = 'content-type';
const X_REQUESTED_WITH_HEADER = 'x-requested-with';
const X_CSRF_TOKEN_HEADER = 'x-csrf-token';

/**
 * Response from the internal job details endpoint.
 */
export type InternalJobResponse = {
  artifacts: unknown;
  state: {
    run: {
      link: string;
      title: string;
      titleHTML: string;
      status: string;
      canCancel: boolean;
      canApprove: boolean;
      canRerun: boolean;
      canDeleteArtifact: boolean;
      done: boolean;
      workflowID: string;
      workflowLink: string;
      isSchedule: boolean;
      jobs: Array<{
        id: number;
        name: string;
        status: string;
        canRerun: boolean;
        duration: string;
      }>;
      commit: {
        shortSHA: string;
        link: string;
        pusher: {
          displayName: string;
          link: string;
        };
        branch: {
          name: string;
          link: string;
          isDeleted: boolean;
        };
      };
    };
    currentJob: {
      title: string;
      detail: string;
      steps: Array<{
        summary: string;
        duration: string;
        status: string;
      }>;
    };
  };
  logs: {
    stepsLog: Array<{
      step: number;
      cursor: number | null;
      lines: Array<{
        index: number;
        message: string;
        timestamp: number;
      }>;
      started?: number;
    }>;
  };
};

/**
 * Log cursor for requesting step logs.
 */
type LogCursor = {
  step: number;
  cursor: number | null;
  expanded: boolean;
};

/**
 * Result of getJobWithSteps including both job info and steps.
 */
export type JobWithSteps = {
  jobId: number;
  jobName: string;
  jobStatus: string;
  jobDuration: string;
  steps: Step[];
};

/**
 * API client for undocumented Gitea internal endpoints.
 * 
 * These endpoints are used by the Gitea web UI and are not part of the
 * official API specification. Use with caution - they may change.
 * 
 * The internal API requires CSRF tokens for POST requests. This class
 * automatically fetches and manages CSRF tokens.
 */
export class GiteaInternalApi {
  private csrfToken: string | undefined;
  private allCookies: string | undefined;

  constructor(private readonly client: GiteaClient) {}

  /**
   * Fetches job details including steps using the internal API.
   * 
   * POST /{owner}/{repo}/actions/runs/{runId}/jobs/{jobIndex}
   * Body: {"logCursors":[]}
   * 
   * @param repo Repository reference
   * @param runId Workflow run ID
   * @param jobIndex 0-based job index within the run
   */
  async getJobWithSteps(
    repo: RepoRef,
    runId: number | string,
    jobIndex: number
  ): Promise<JobWithSteps> {
    const path = `/${repo.owner}/${repo.name}/actions/runs/${runId}/jobs/${jobIndex}`;
    const response = await this.postJson<InternalJobResponse>(path, { logCursors: [] }, repo, runId);

    const currentJob = response.state?.currentJob;
    const jobs = response.state?.run?.jobs ?? [];
    const jobInfo = jobs[jobIndex];

    const steps: Step[] = (currentJob?.steps ?? []).map((s, index) => {
      // Internal API uses conclusion values (success/failure) as status
      // Map these to proper status + conclusion
      const rawStatus = s.status?.toLowerCase() ?? '';
      const isConclusionStatus = ['success', 'failure', 'cancelled', 'skipped'].includes(rawStatus);
      
      return {
        name: s.summary,
        status: isConclusionStatus ? 'completed' : normalizeStatus(s.status),
        conclusion: normalizeConclusion(s.status),
        duration: s.duration,
        stepIndex: index
      };
    });

    return {
      jobId: jobInfo?.id ?? 0,
      jobName: currentJob?.title ?? jobInfo?.name ?? 'Job',
      jobStatus: jobInfo?.status ?? currentJob?.detail ?? 'unknown',
      jobDuration: jobInfo?.duration ?? '',
      steps
    };
  }

  /**
   * Fetches logs for a specific step using the internal API.
   * 
   * POST /{owner}/{repo}/actions/runs/{runId}/jobs/{jobIndex}
   * Body: {"logCursors":[{"step":N,"cursor":null,"expanded":true},...]}
   * 
   * @param repo Repository reference
   * @param runId Workflow run ID
   * @param jobIndex 0-based job index within the run
   * @param stepIndex 0-based step index to fetch logs for
   * @param totalSteps Total number of steps (needed to build cursor array)
   */
  async getStepLogs(
    repo: RepoRef,
    runId: number | string,
    jobIndex: number,
    stepIndex: number,
    totalSteps: number
  ): Promise<StepLog | undefined> {
    const path = `/${repo.owner}/${repo.name}/actions/runs/${runId}/jobs/${jobIndex}`;
    
    // Build log cursors array - only the requested step is expanded
    const logCursors: LogCursor[] = [];
    for (let i = 0; i < totalSteps; i++) {
      logCursors.push({
        step: i,
        cursor: null,
        expanded: i === stepIndex
      });
    }

    const response = await this.postJson<InternalJobResponse>(path, { logCursors }, repo, runId);
    
    const stepsLog = response.logs?.stepsLog ?? [];
    const stepLog = stepsLog.find(sl => sl.step === stepIndex);
    
    if (!stepLog) {
      return undefined;
    }

    return {
      step: stepLog.step,
      cursor: stepLog.cursor,
      lines: stepLog.lines.map(line => ({
        index: line.index,
        message: line.message,
        timestamp: line.timestamp
      })),
      started: stepLog.started
    };
  }

  /**
   * Fetches logs for all steps at once.
   * Useful for getting complete job logs with step boundaries.
   */
  async getAllStepLogs(
    repo: RepoRef,
    runId: number | string,
    jobIndex: number,
    totalSteps: number
  ): Promise<StepLog[]> {
    const path = `/${repo.owner}/${repo.name}/actions/runs/${runId}/jobs/${jobIndex}`;
    
    // Build log cursors array - all steps expanded
    const logCursors: LogCursor[] = [];
    for (let i = 0; i < totalSteps; i++) {
      logCursors.push({
        step: i,
        cursor: null,
        expanded: true
      });
    }

    const response = await this.postJson<InternalJobResponse>(path, { logCursors }, repo, runId);
    
    return (response.logs?.stepsLog ?? []).map(sl => ({
      step: sl.step,
      cursor: sl.cursor,
      lines: sl.lines.map(line => ({
        index: line.index,
        message: line.message,
        timestamp: line.timestamp
      })),
      started: sl.started
    }));
  }

  /**
   * Formats step log lines into a readable string.
   */
  static formatStepLogs(stepLog: StepLog): string {
    if (!stepLog.lines.length) {
      return '(No log output)';
    }

    return stepLog.lines
      .map(line => {
        const date = new Date(line.timestamp * 1000);
        const timestamp = date.toISOString().replace('T', ' ').replace('Z', '');
        return `${timestamp} | ${line.message}`;
      })
      .join('\n');
  }

  /**
   * Formats all step logs with step headers.
   */
  static formatAllStepLogs(stepLogs: StepLog[], steps: Step[]): string {
    const parts: string[] = [];

    for (const stepLog of stepLogs) {
      const stepInfo = steps[stepLog.step];
      const stepName = stepInfo?.name ?? `Step ${stepLog.step}`;
      const header = `\n${'='.repeat(60)}\n[Step ${stepLog.step}] ${stepName}\n${'='.repeat(60)}\n`;
      parts.push(header);
      parts.push(this.formatStepLogs(stepLog));
    }

    return parts.join('\n');
  }

  /**
   * Fetches a CSRF token by making a GET request to the actions page.
   * The token is extracted from the Set-Cookie header or HTML meta tag.
   */
  private async fetchCsrfToken(repo: RepoRef, runId: number | string): Promise<void> {
    const path = `/${repo.owner}/${repo.name}/actions/runs/${runId}`;
    
    try {
      logDebug(`Fetching CSRF token from ${path}`);
      const res = await this.client.request(path, {
        method: 'GET'
      } as RequestInit);

      // Try multiple methods to extract CSRF token
      
      // Method 1: Use getSetCookie() for undici (returns array of all Set-Cookie headers)
      const collectedCookies: string[] = [];
      const headersAny = res.headers as unknown as { getSetCookie?: () => string[] };
      if (typeof headersAny.getSetCookie === 'function') {
        const cookies = headersAny.getSetCookie();
        for (const cookie of cookies) {
          // Extract cookie name=value part (before first semicolon)
          const cookiePart = cookie.split(';')[0];
          if (cookiePart) {
            collectedCookies.push(cookiePart);
          }
          const csrfMatch = cookie.match(/_csrf=([^;]+)/);
          if (csrfMatch) {
            this.csrfToken = csrfMatch[1];
          }
        }
        if (this.csrfToken && collectedCookies.length > 0) {
          this.allCookies = collectedCookies.join('; ');
          logDebug(`CSRF token and ${collectedCookies.length} cookies obtained from getSetCookie()`);
          return;
        }
      }

      // Method 2: Try regular get('set-cookie') header
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const csrfMatch = setCookie.match(/_csrf=([^;]+)/);
        if (csrfMatch) {
          this.csrfToken = csrfMatch[1];
          this.allCookies = `_csrf=${this.csrfToken}`;
          logDebug(`CSRF token obtained from set-cookie header`);
          return;
        }
      }

      // Method 3: Parse the HTML response for meta tag or form field
      const text = await res.text();
      
      // Look for meta tag
      let metaMatch = text.match(/name="_csrf"\s+content="([^"]+)"/);
      if (metaMatch) {
        this.csrfToken = metaMatch[1];
        this.allCookies = `_csrf=${this.csrfToken}`;
        logDebug(`CSRF token obtained from meta tag`);
        return;
      }

      // Look for hidden input field
      metaMatch = text.match(/<input[^>]+name="_csrf"[^>]+value="([^"]+)"/);
      if (metaMatch) {
        this.csrfToken = metaMatch[1];
        this.allCookies = `_csrf=${this.csrfToken}`;
        logDebug(`CSRF token obtained from hidden input`);
        return;
      }

      // Look for data attribute
      metaMatch = text.match(/data-csrf="([^"]+)"/);
      if (metaMatch) {
        this.csrfToken = metaMatch[1];
        this.allCookies = `_csrf=${this.csrfToken}`;
        logDebug(`CSRF token obtained from data-csrf attribute`);
        return;
      }

      logWarn('Could not extract CSRF token from response - tried cookies, meta tags, inputs, and data attributes');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Failed to fetch CSRF token: ${message}`);
    }
  }

  /**
   * Ensures a CSRF token is available, fetching one if necessary.
   */
  private async ensureCsrfToken(repo: RepoRef, runId: number | string): Promise<void> {
    if (!this.csrfToken) {
      await this.fetchCsrfToken(repo, runId);
    }
  }

  private async postJson<T>(path: string, body: unknown, repo?: RepoRef, runId?: number | string): Promise<T> {
    // Ensure we have a CSRF token
    if (repo && runId) {
      await this.ensureCsrfToken(repo, runId);
    }

    // Build the full referer URL (same as the page we fetched CSRF from)
    const refererPath = repo && runId 
      ? `${this.client.baseUrl}/${repo.owner}/${repo.name}/actions/runs/${runId}` 
      : `${this.client.baseUrl}${path}`;

    const headers: Record<string, string> = {
      [CONTENT_TYPE_HEADER]: 'application/json',
      // Accept JSON response (must be set explicitly since client respects existing Accept headers now)
      'accept': 'application/json',
      // Some servers check Referer for CSRF protection
      'referer': refererPath,
      // Mark as AJAX request
      [X_REQUESTED_WITH_HEADER]: 'XMLHttpRequest'
    };

    // Add CSRF headers if available
    if (this.csrfToken) {
      headers[X_CSRF_TOKEN_HEADER] = this.csrfToken;
    }
    if (this.allCookies) {
      headers['cookie'] = this.allCookies;
    }

    logDebug(`POST ${path} with CSRF token: ${this.csrfToken ? 'yes' : 'no'}, cookies: ${this.allCookies ? 'yes' : 'no'}`);

    const res = await this.client.request(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    } as RequestInit);

    const text = await res.text();
    
    // Check for CSRF error and retry once with fresh token
    if (!res.ok && text.includes('CSRF')) {
      logDebug('CSRF token invalid, refreshing...');
      this.csrfToken = undefined;
      this.allCookies = undefined;
      
      if (repo && runId) {
        await this.fetchCsrfToken(repo, runId);
        
        // Retry with fresh token
        const retryHeaders: Record<string, string> = {
          [CONTENT_TYPE_HEADER]: 'application/json'
        };
        if (this.csrfToken) {
          retryHeaders[X_CSRF_TOKEN_HEADER] = this.csrfToken;
        }
        if (this.allCookies) {
          retryHeaders['cookie'] = this.allCookies;
        }

        const retryRes = await this.client.request(path, {
          method: 'POST',
          headers: retryHeaders,
          body: JSON.stringify(body)
        } as RequestInit);

        const retryText = await retryRes.text();
        
        if (!retryRes.ok) {
          throw new Error(`Request failed (${retryRes.status}): ${retryText || retryRes.statusText}`);
        }

        const retryContentType = retryRes.headers.get('content-type') ?? '';
        if (retryContentType.includes('application/json')) {
          return JSON.parse(retryText) as T;
        }

        throw new Error(`Unexpected response type: ${retryContentType || 'unknown'}`);
      }
    }
    
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return JSON.parse(text) as T;
    }

    throw new Error(`Unexpected response type: ${contentType || 'unknown'}`);
  }
}
