/** Reject Gitea zero/unset timestamps (epoch, Go zero time, numeric 0). */
const MIN_VALID_MS = Date.UTC(2000, 0, 1);

export function normalizeTimestamp(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  let ms: number;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value === 0) {
      return undefined;
    }
    // Gitea TimeStamp fields are Unix seconds; JS Date expects milliseconds.
    ms = value < 1e12 ? value * 1000 : value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '0') {
      return undefined;
    }
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (!Number.isFinite(num) || num === 0) {
        return undefined;
      }
      ms = num < 1e12 ? num * 1000 : num;
    } else {
      ms = new Date(trimmed).getTime();
    }
  } else {
    return undefined;
  }

  if (!Number.isFinite(ms) || ms < MIN_VALID_MS) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

export function pickTimestamp(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const normalized = normalizeTimestamp(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

/** Best available start/end timestamps for a workflow run duration. */
export function runDurationTimestamps(run: {
  startedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}): { start?: string; end?: string } {
  return {
    // Skip zero started_at; fall back to created/updated when a run was cancelled before starting.
    start: pickTimestamp(run.startedAt, run.createdAt, run.updatedAt),
    end: pickTimestamp(run.completedAt, run.updatedAt)
  };
}

export function formatRunDuration(run: {
  startedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}): string {
  const { start, end } = runDurationTimestamps(run);
  return formatDuration(start, end);
}

export function pickRunTriggerTime(run: {
  startedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}): string | undefined {
  return pickTimestamp(run.startedAt, run.createdAt, run.updatedAt);
}

export function formatDuration(start?: string, end?: string): string {
  const normalizedStart = normalizeTimestamp(start);
  if (!normalizedStart) {
    return '';
  }
  const startDate = new Date(normalizedStart);
  const normalizedEnd = normalizeTimestamp(end);
  const endDate = normalizedEnd ? new Date(normalizedEnd) : new Date();
  const ms = endDate.getTime() - startDate.getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return '';
  }
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  const remSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${remMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remSeconds}s`;
  }
  return `${seconds}s`;
}

export function formatAgo(date?: string): string {
  const normalized = normalizeTimestamp(date);
  if (!normalized) {
    return '';
  }
  const target = new Date(normalized);
  const delta = Date.now() - target.getTime();
  if (!Number.isFinite(delta)) {
    return '';
  }
  const seconds = Math.floor(delta / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return `${seconds}s ago`;
}

export function formatDateTime(date?: string): string {
  const normalized = normalizeTimestamp(date);
  if (!normalized) {
    return '';
  }
  const value = new Date(normalized);
  if (Number.isNaN(value.getTime())) {
    return '';
  }
  return value.toLocaleString();
}
