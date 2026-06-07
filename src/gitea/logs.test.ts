import { describe, expect, it } from 'vitest';
import { extractStepLogFromJobLog } from './logs';
import { Step } from './models';

describe('extractStepLogFromJobLog', () => {
  it('extracts a step by runner group markers', () => {
    const steps: Step[] = [
      { name: 'Checkout', status: 'completed' },
      { name: 'npm test', status: 'completed' }
    ];
    const log = [
      '2026-06-07T00:00:00Z ##[group]Run Checkout',
      '2026-06-07T00:00:01Z checking out',
      '2026-06-07T00:00:02Z ##[endgroup]',
      '2026-06-07T00:00:03Z ##[group]Run npm test',
      '2026-06-07T00:00:04Z test output',
      '2026-06-07T00:00:05Z ##[endgroup]'
    ].join('\n');

    const result = extractStepLogFromJobLog(log, steps, 1);

    expect(result?.exact).toBe(true);
    expect(result?.reason).toBe('markers');
    expect(result?.content).toContain('test output');
    expect(result?.content).not.toContain('checking out');
  });

  it('extracts a step by official step timestamps', () => {
    const steps: Step[] = [
      {
        name: 'Checkout',
        status: 'completed',
        startedAt: '2026-06-07T00:00:00Z',
        completedAt: '2026-06-07T00:00:05Z'
      },
      {
        name: 'Build',
        status: 'completed',
        startedAt: '2026-06-07T00:00:05Z',
        completedAt: '2026-06-07T00:00:10Z'
      }
    ];
    const log = [
      '2026-06-07T00:00:01Z checkout output',
      '2026-06-07T00:00:06.123456789Z build output',
      '2026-06-07T00:00:09Z build done'
    ].join('\n');

    const result = extractStepLogFromJobLog(log, steps, 1);

    expect(result?.exact).toBe(true);
    expect(result?.reason).toBe('timestamps');
    expect(result?.content).toContain('build output');
    expect(result?.content).not.toContain('checkout output');
  });

  it('returns a full-job fallback when the step cannot be isolated', () => {
    const steps: Step[] = [{ name: 'Build', status: 'completed' }];
    const log = 'plain log line without timestamp';

    const result = extractStepLogFromJobLog(log, steps, 0);

    expect(result?.exact).toBe(false);
    expect(result?.reason).toBe('unfiltered');
    expect(result?.content).toContain('Showing the full job log instead.');
    expect(result?.content).toContain(log);
  });
});
