/**
 * Gitea server version parsing and feature gating.
 *
 * Version strings come from GET /api/v1/version and look like "1.27.0",
 * "1.27.0+dev-123-gabcdef", "1.28.0-rc1", or "v1.27.1".
 */

/**
 * Parses the leading major.minor(.patch) numbers from a Gitea version string.
 * Returns undefined when the string does not start with a recognizable version.
 */
export function parseVersion(version?: string | null): { major: number; minor: number; patch: number } | undefined {
  if (!version) {
    return undefined;
  }
  const match = version.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] ? Number(match[3]) : 0
  };
}

/**
 * Returns true when `version` is at least `major.minor`.
 * Unparseable/unknown versions return false (assume older server).
 */
export function isVersionAtLeast(version: string | null | undefined, major: number, minor: number): boolean {
  const parsed = parseVersion(version);
  if (!parsed) {
    return false;
  }
  if (parsed.major !== major) {
    return parsed.major > major;
  }
  return parsed.minor >= minor;
}

/**
 * Gitea 1.27.0 added GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs (#37196),
 * which lets us fetch run history per workflow instead of only repo-wide.
 */
export function supportsPerWorkflowRuns(version: string | null | undefined): boolean {
  return isVersionAtLeast(version, 1, 27);
}
