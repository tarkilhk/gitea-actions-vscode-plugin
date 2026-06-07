import { Step } from './models';

export type ExtractedStepLog = {
  content: string;
  exact: boolean;
  reason: 'markers' | 'timestamps' | 'unfiltered';
};

const ISO_TIMESTAMP_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)(?:\s+\|\s+|\s+)?/;
const BRACKETED_ISO_TIMESTAMP_PREFIX = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\]\s*/;
const GROUP_MARKER = /(?:##\[group\]|::group::)\s*(.*)$/;
const END_GROUP_MARKER = /(?:##\[endgroup\]|::endgroup::)/;

function normalizeLogTitle(value: string): string {
  return value
    .replace(ISO_TIMESTAMP_PREFIX, '')
    .replace(BRACKETED_ISO_TIMESTAMP_PREFIX, '')
    .replace(/^Run\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseLineTimestamp(line: string): number | undefined {
  const match = line.match(ISO_TIMESTAMP_PREFIX) ?? line.match(BRACKETED_ISO_TIMESTAMP_PREFIX);
  if (!match) {
    return undefined;
  }
  const iso = match[1].replace(/\.(\d{3})\d+Z$/, '.$1Z');
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function extractByGroupMarkers(lines: string[], step: Step): string | undefined {
  const target = normalizeLogTitle(step.name);
  if (!target) {
    return undefined;
  }

  const groups: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | undefined;

  for (const line of lines) {
    const groupMatch = line.match(GROUP_MARKER);
    if (groupMatch) {
      current = { title: normalizeLogTitle(groupMatch[1]), lines: [] };
      groups.push(current);
      continue;
    }

    if (END_GROUP_MARKER.test(line)) {
      current = undefined;
      continue;
    }

    current?.lines.push(line);
  }

  const match = groups.find((group) => group.title === target || group.title.includes(target) || target.includes(group.title));
  if (!match || !match.lines.length) {
    return undefined;
  }

  return match.lines.join('\n');
}

function extractByTimestamps(lines: string[], steps: Step[], stepIndex: number): string | undefined {
  const step = steps[stepIndex];
  const start = step?.startedAt ? Date.parse(step.startedAt) : Number.NaN;
  if (!Number.isFinite(start)) {
    return undefined;
  }

  const nextStepStart = steps[stepIndex + 1]?.startedAt ? Date.parse(steps[stepIndex + 1].startedAt!) : Number.NaN;
  const completed = step.completedAt ? Date.parse(step.completedAt) : Number.NaN;
  const end = Number.isFinite(nextStepStart) ? nextStepStart : completed;
  const hasEnd = Number.isFinite(end);
  const startToleranceMs = 1000;
  const endToleranceMs = Number.isFinite(nextStepStart) ? 0 : 1000;

  const selected = lines.filter((line) => {
    const timestamp = parseLineTimestamp(line);
    if (timestamp == null) {
      return false;
    }
    if (timestamp < start - startToleranceMs) {
      return false;
    }
    if (hasEnd && timestamp >= end + endToleranceMs) {
      return false;
    }
    return true;
  });

  if (!selected.length || selected.length === lines.length) {
    return undefined;
  }

  return selected.join('\n');
}

export function extractStepLogFromJobLog(jobLog: string, steps: Step[] | undefined, stepIndex: number): ExtractedStepLog | undefined {
  const step = steps?.[stepIndex];
  if (!jobLog || !step || stepIndex < 0) {
    return undefined;
  }

  const lines = jobLog.split(/\r?\n/);
  const markerContent = extractByGroupMarkers(lines, step);
  if (markerContent) {
    return { content: markerContent, exact: true, reason: 'markers' };
  }

  const timestampContent = extractByTimestamps(lines, steps ?? [], stepIndex);
  if (timestampContent) {
    return { content: timestampContent, exact: true, reason: 'timestamps' };
  }

  return {
    content: [
      `Gitea ${step.name ? `does not expose a separate log stream for "${step.name}"` : 'does not expose a separate log stream for this step'} in the official API.`,
      'Showing the full job log instead.',
      '',
      jobLog
    ].join('\n'),
    exact: false,
    reason: 'unfiltered'
  };
}
