import { describe, expect, it } from 'vitest';
import { hasOfficialSteps, jobsMissingOfficialSteps, shouldUseLegacyStepFallback } from './jobSteps';
import { Job } from './models';

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 1,
    name: 'build',
    status: 'completed',
    ...overrides
  };
}

describe('hasOfficialSteps', () => {
  it('is true for an empty official steps array', () => {
    expect(hasOfficialSteps(job({ steps: [] }))).toBe(true);
  });

  it('is true when the official API returned steps', () => {
    expect(hasOfficialSteps(job({ steps: [{ name: 'checkout', status: 'completed' }] }))).toBe(true);
  });

  it('is false when older Gitea omitted steps', () => {
    expect(hasOfficialSteps(job())).toBe(false);
  });
});

describe('jobsMissingOfficialSteps', () => {
  it('returns only jobs whose official payload omitted steps', () => {
    const missing = jobsMissingOfficialSteps([
      job({ id: 1, steps: [{ name: 'checkout', status: 'completed' }] }),
      job({ id: 2, steps: [] }),
      job({ id: 3 }),
      job({ id: 4, stepsError: 'gated' })
    ]);
    expect(missing.map((j) => j.id)).toEqual([3]);
  });
});

describe('shouldUseLegacyStepFallback', () => {
  it('skips workarounds on Gitea 1.26+ even if a job has no steps yet', () => {
    expect(shouldUseLegacyStepFallback('1.26.0', [job()])).toBe(false);
    expect(shouldUseLegacyStepFallback('1.27.2', [job({ steps: [] })])).toBe(false);
  });

  it('uses workarounds on older servers when listJobs omitted steps', () => {
    expect(shouldUseLegacyStepFallback('1.25.4', [job()])).toBe(true);
    expect(shouldUseLegacyStepFallback(undefined, [job()])).toBe(true);
  });

  it('skips workarounds on older servers when listJobs already had steps', () => {
    expect(shouldUseLegacyStepFallback('1.25.4', [job({ steps: [{ name: 'x', status: 'completed' }] })])).toBe(false);
  });
});
