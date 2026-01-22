import { describe, it, expect, vi } from 'vitest';
import { GiteaInternalApi, InternalJobResponse } from './internalApi';
import { GiteaClient } from './client';
import { RepoRef, StepLog } from './models';

const giteaClientExport = 'GiteaClient';

// Mock the client
vi.mock('./client', () => ({
  [giteaClientExport]: vi.fn()
}));

const mockRepo: RepoRef = {
  host: 'gitea.example.com',
  owner: 'testowner',
  name: 'testrepo'
};

function createMockClient(responseData: unknown) {
  return {
    request: vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify(responseData)),
      headers: {
        get: vi.fn().mockReturnValue('application/json')
      }
    })
  } as unknown as GiteaClient;
}

function createMockJobResponse(overrides?: Partial<InternalJobResponse>): InternalJobResponse {
  return {
    artifacts: null,
    state: {
      run: {
        link: '/testowner/testrepo/actions/runs/123',
        title: 'Test Run',
        titleHTML: 'Test Run',
        status: 'success',
        canCancel: false,
        canApprove: false,
        canRerun: true,
        canDeleteArtifact: true,
        done: true,
        workflowID: 'test.yaml',
        workflowLink: '/testowner/testrepo/actions/?workflow=test.yaml',
        isSchedule: false,
        jobs: [
          { id: 100, name: 'build', status: 'success', canRerun: true, duration: '30s' },
          { id: 101, name: 'test', status: 'success', canRerun: true, duration: '45s' }
        ],
        commit: {
          shortSHA: 'abc1234',
          link: '/testowner/testrepo/commit/abc1234',
          pusher: { displayName: 'testuser', link: '/testuser' },
          branch: { name: 'main', link: '/testowner/testrepo/src/branch/main', isDeleted: false }
        }
      },
      currentJob: {
        title: 'build',
        detail: 'Success',
        steps: [
          { summary: 'Set up job', duration: '1s', status: 'success' },
          { summary: 'Checkout', duration: '2s', status: 'success' },
          { summary: 'Build', duration: '25s', status: 'success' },
          { summary: 'Complete job', duration: '1s', status: 'success' }
        ]
      }
    },
    logs: {
      stepsLog: []
    },
    ...overrides
  };
}

describe('GiteaInternalApi', () => {
  describe('getJobWithSteps', () => {
    it('fetches job with steps from internal API', async () => {
      const mockResponse = createMockJobResponse();
      const client = createMockClient(mockResponse);
      const api = new GiteaInternalApi(client);

      const result = await api.getJobWithSteps(mockRepo, 123, 0);

      expect(result.jobId).toBe(100);
      expect(result.jobName).toBe('build');
      expect(result.jobStatus).toBe('success');
      expect(result.jobDuration).toBe('30s');
      expect(result.steps).toHaveLength(4);
      expect(result.steps[0].name).toBe('Set up job');
      expect(result.steps[0].duration).toBe('1s');
      expect(result.steps[0].stepIndex).toBe(0);
    });

    it('sends correct POST request', async () => {
      const mockResponse = createMockJobResponse();
      const client = createMockClient(mockResponse);
      const api = new GiteaInternalApi(client);

      await api.getJobWithSteps(mockRepo, 456, 1);

      expect(client.request).toHaveBeenCalledWith(
        '/testowner/testrepo/actions/runs/456/jobs/1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ logCursors: [] })
        })
      );
    });

    it('normalizes step status correctly', async () => {
      const mockResponse = createMockJobResponse({
        state: {
          ...createMockJobResponse().state,
          currentJob: {
            title: 'build',
            detail: 'Running',
            steps: [
              { summary: 'Step 1', duration: '1s', status: 'success' },
              { summary: 'Step 2', duration: '0s', status: 'running' },
              { summary: 'Step 3', duration: '', status: 'waiting' },
              { summary: 'Step 4', duration: '1s', status: 'failure' }
            ]
          }
        }
      });
      const client = createMockClient(mockResponse);
      const api = new GiteaInternalApi(client);

      const result = await api.getJobWithSteps(mockRepo, 123, 0);

      // "success" and "failure" as status -> completed with respective conclusion
      expect(result.steps[0].status).toBe('completed');
      expect(result.steps[0].conclusion).toBe('success');
      
      expect(result.steps[1].status).toBe('running');
      
      expect(result.steps[2].status).toBe('queued');
      
      expect(result.steps[3].status).toBe('completed');
      expect(result.steps[3].conclusion).toBe('failure');
    });

    it('handles missing job info gracefully', async () => {
      const mockResponse = createMockJobResponse({
        state: {
          ...createMockJobResponse().state,
          run: {
            ...createMockJobResponse().state.run,
            jobs: [] // No jobs in array
          }
        }
      });
      const client = createMockClient(mockResponse);
      const api = new GiteaInternalApi(client);

      const result = await api.getJobWithSteps(mockRepo, 123, 0);

      expect(result.jobId).toBe(0);
      expect(result.jobName).toBe('build'); // Falls back to currentJob.title
    });
  });

  describe('getStepLogs', () => {
    it('fetches logs for a specific step', async () => {
      const mockResponse = createMockJobResponse({
        logs: {
          stepsLog: [
            {
              step: 0,
              cursor: 10,
              lines: [
                { index: 1, message: 'Starting step', timestamp: 1700000000 },
                { index: 2, message: 'Step completed', timestamp: 1700000001 }
              ],
              started: 1700000000
            }
          ]
        }
      });
      const client = createMockClient(mockResponse);
      const api = new GiteaInternalApi(client);

      const result = await api.getStepLogs(mockRepo, 123, 0, 0, 4);

      expect(result).toBeDefined();
      expect(result!.step).toBe(0);
      expect(result!.cursor).toBe(10);
      expect(result!.lines).toHaveLength(2);
      expect(result!.lines[0].message).toBe('Starting step');
    });

    it('sends correct logCursors payload', async () => {
      const mockResponse = createMockJobResponse();
      const client = createMockClient(mockResponse);
      const api = new GiteaInternalApi(client);

      await api.getStepLogs(mockRepo, 123, 0, 1, 4);

      expect(client.request).toHaveBeenCalledWith(
        '/testowner/testrepo/actions/runs/123/jobs/0',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            logCursors: [
              { step: 0, cursor: null, expanded: false },
              { step: 1, cursor: null, expanded: true }, // Only step 1 is expanded
              { step: 2, cursor: null, expanded: false },
              { step: 3, cursor: null, expanded: false }
            ]
          })
        })
      );
    });

    it('returns undefined when step log not found', async () => {
      const mockResponse = createMockJobResponse({
        logs: { stepsLog: [] }
      });
      const client = createMockClient(mockResponse);
      const api = new GiteaInternalApi(client);

      const result = await api.getStepLogs(mockRepo, 123, 0, 0, 4);

      expect(result).toBeUndefined();
    });
  });

  describe('getAllStepLogs', () => {
    it('fetches logs for all steps with all expanded', async () => {
      const mockResponse = createMockJobResponse({
        logs: {
          stepsLog: [
            { step: 0, cursor: 5, lines: [{ index: 1, message: 'Log 1', timestamp: 1700000000 }] },
            { step: 1, cursor: 3, lines: [{ index: 1, message: 'Log 2', timestamp: 1700000001 }] }
          ]
        }
      });
      const client = createMockClient(mockResponse);
      const api = new GiteaInternalApi(client);

      const result = await api.getAllStepLogs(mockRepo, 123, 0, 2);

      expect(result).toHaveLength(2);
      expect(result[0].step).toBe(0);
      expect(result[1].step).toBe(1);
    });

    it('sends all steps as expanded in payload', async () => {
      const mockResponse = createMockJobResponse();
      const client = createMockClient(mockResponse);
      const api = new GiteaInternalApi(client);

      await api.getAllStepLogs(mockRepo, 123, 0, 3);

      expect(client.request).toHaveBeenCalledWith(
        '/testowner/testrepo/actions/runs/123/jobs/0',
        expect.objectContaining({
          body: JSON.stringify({
            logCursors: [
              { step: 0, cursor: null, expanded: true },
              { step: 1, cursor: null, expanded: true },
              { step: 2, cursor: null, expanded: true }
            ]
          })
        })
      );
    });
  });

  describe('formatStepLogs', () => {
    it('formats step log lines with timestamps', () => {
      const stepLog: StepLog = {
        step: 0,
        cursor: null,
        lines: [
          { index: 1, message: 'Hello world', timestamp: 1700000000 },
          { index: 2, message: 'Goodbye', timestamp: 1700000001 }
        ]
      };

      const result = GiteaInternalApi.formatStepLogs(stepLog);

      expect(result).toContain('Hello world');
      expect(result).toContain('Goodbye');
      expect(result).toContain('|'); // Separator between timestamp and message
    });

    it('returns placeholder for empty logs', () => {
      const stepLog: StepLog = {
        step: 0,
        cursor: null,
        lines: []
      };

      const result = GiteaInternalApi.formatStepLogs(stepLog);

      expect(result).toBe('(No log output)');
    });
  });

  describe('formatAllStepLogs', () => {
    it('formats multiple step logs with headers', () => {
      const stepLogs: StepLog[] = [
        { step: 0, cursor: null, lines: [{ index: 1, message: 'Step 0 log', timestamp: 1700000000 }] },
        { step: 1, cursor: null, lines: [{ index: 1, message: 'Step 1 log', timestamp: 1700000001 }] }
      ];
      const steps = [
        { name: 'Setup', status: 'completed' as const },
        { name: 'Build', status: 'completed' as const }
      ];

      const result = GiteaInternalApi.formatAllStepLogs(stepLogs, steps);

      expect(result).toContain('[Step 0] Setup');
      expect(result).toContain('[Step 1] Build');
      expect(result).toContain('Step 0 log');
      expect(result).toContain('Step 1 log');
      expect(result).toContain('='.repeat(60)); // Header separator
    });
  });

  describe('error handling', () => {
    it('throws error on non-OK response', async () => {
      const client = {
        request: vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: vi.fn().mockResolvedValue('Not found'),
          headers: { get: vi.fn().mockReturnValue('text/plain') }
        })
      } as unknown as GiteaClient;
      const api = new GiteaInternalApi(client);

      await expect(api.getJobWithSteps(mockRepo, 123, 0)).rejects.toThrow('Request failed (404)');
    });

    it('throws error on non-JSON response', async () => {
      const client = {
        request: vi.fn().mockResolvedValue({
          ok: true,
          text: vi.fn().mockResolvedValue('<html>Error</html>'),
          headers: { get: vi.fn().mockReturnValue('text/html') }
        })
      } as unknown as GiteaClient;
      const api = new GiteaInternalApi(client);

      await expect(api.getJobWithSteps(mockRepo, 123, 0)).rejects.toThrow('Unexpected response type');
    });
  });
});
