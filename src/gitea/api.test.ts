import { describe, it, expect } from 'vitest';
import { pickArray, mapRun, mapJob, mapStep } from './api';
import { RepoRef } from './models';

const mockRepo: RepoRef = {
  host: 'gitea.example.com',
  owner: 'testowner',
  name: 'testrepo'
};

describe('pickArray', () => {
  it('returns array directly if input is array', () => {
    const input = [1, 2, 3];
    expect(pickArray(input)).toEqual([1, 2, 3]);
  });

  it('extracts data array from object', () => {
    const input = { data: [1, 2, 3] };
    expect(pickArray(input)).toEqual([1, 2, 3]);
  });

  it('extracts workflow_runs array from object', () => {
    const input = { workflow_runs: [{ id: 1 }, { id: 2 }] };
    expect(pickArray(input)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('prefers data over workflow_runs', () => {
    const input = { data: [1], workflow_runs: [2] };
    expect(pickArray(input)).toEqual([1]);
  });

  it('returns fallback for non-array, non-object input', () => {
    expect(pickArray('string', [])).toEqual([]);
    expect(pickArray(123, [])).toEqual([]);
    expect(pickArray(null, ['fallback'])).toEqual(['fallback']);
  });

  it('returns fallback for object without arrays', () => {
    const input = { foo: 'bar' };
    expect(pickArray(input, ['default'])).toEqual(['default']);
  });
});

describe('mapRun', () => {
  it('maps basic run data', () => {
    const raw = {
      id: 123,
      status: 'completed',
      conclusion: 'success',
      name: 'Test Run'
    };
    const result = mapRun(mockRepo, raw);
    
    expect(result.id).toBe(123);
    expect(result.status).toBe('completed');
    expect(result.conclusion).toBe('success');
    expect(result.name).toBe('Test Run');
  });

  it('handles snake_case field names', () => {
    const raw = {
      id: 1,
      run_number: 42,
      head_branch: 'main',
      head_sha: 'abc123',
      created_at: '2024-01-01T00:00:00Z',
      html_url: 'https://example.com/run/1'
    };
    const result = mapRun(mockRepo, raw);
    
    expect(result.runNumber).toBe(42);
    expect(result.branch).toBe('main');
    expect(result.sha).toBe('abc123');
    expect(result.createdAt).toBe('2024-01-01T00:00:00Z');
    expect(result.htmlUrl).toBe('https://example.com/run/1');
  });

  it('handles camelCase field names', () => {
    const raw = {
      id: 1,
      runNumber: 42,
      headBranch: 'main',
      headSha: 'abc123',
      createdAt: '2024-01-01T00:00:00Z'
    };
    const result = mapRun(mockRepo, raw);
    
    expect(result.runNumber).toBe(42);
    expect(result.createdAt).toBe('2024-01-01T00:00:00Z');
  });

  it('extracts workflow name from various sources', () => {
    // From workflow.name
    let result = mapRun(mockRepo, { id: 1, workflow: { name: 'CI' } });
    expect(result.workflowName).toBe('CI');

    // From workflow_name
    result = mapRun(mockRepo, { id: 1, workflow_name: 'Build' });
    expect(result.workflowName).toBe('Build');

    // From workflowName
    result = mapRun(mockRepo, { id: 1, workflowName: 'Test' });
    expect(result.workflowName).toBe('Test');
  });

  it('extracts actor from nested object', () => {
    const raw = {
      id: 1,
      actor: { login: 'testuser' }
    };
    const result = mapRun(mockRepo, raw);
    expect(result.actor).toBe('testuser');
  });

  it('extracts actor from username field', () => {
    const raw = {
      id: 1,
      actor: { username: 'testuser2' }
    };
    const result = mapRun(mockRepo, raw);
    expect(result.actor).toBe('testuser2');
  });

  it('normalizes status correctly', () => {
    let result = mapRun(mockRepo, { id: 1, status: 'in_progress' });
    expect(result.status).toBe('running');

    result = mapRun(mockRepo, { id: 1, status: 'queued' });
    expect(result.status).toBe('queued');

    result = mapRun(mockRepo, { id: 1, status: 'completed' });
    expect(result.status).toBe('completed');
  });

  it('provides fallback for missing id', () => {
    const result = mapRun(mockRepo, { status: 'completed' });
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
  });
});

describe('mapJob', () => {
  it('maps basic job data', () => {
    const raw = {
      id: 456,
      name: 'build',
      status: 'completed',
      conclusion: 'success'
    };
    const result = mapJob(raw);
    
    expect(result.id).toBe(456);
    expect(result.name).toBe('build');
    expect(result.status).toBe('completed');
    expect(result.conclusion).toBe('success');
  });

  it('handles snake_case timestamps', () => {
    const raw = {
      id: 1,
      started_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T00:05:00Z'
    };
    const result = mapJob(raw);
    
    expect(result.startedAt).toBe('2024-01-01T00:00:00Z');
    expect(result.completedAt).toBe('2024-01-01T00:05:00Z');
  });

  it('maps steps when present', () => {
    const raw = {
      id: 1,
      name: 'job',
      steps: [
        { id: 1, name: 'Step 1', status: 'completed', conclusion: 'success' },
        { id: 2, name: 'Step 2', status: 'running' }
      ]
    };
    const result = mapJob(raw);
    
    expect(result.steps).toHaveLength(2);
    expect(result.steps![0].name).toBe('Step 1');
    expect(result.steps![1].name).toBe('Step 2');
  });

  it('returns undefined steps when not present', () => {
    const raw = { id: 1, name: 'job' };
    const result = mapJob(raw);
    expect(result.steps).toBeUndefined();
  });

  it('provides fallback name when missing', () => {
    const raw = { id: 1 };
    const result = mapJob(raw);
    expect(result.name).toBe('Job');
  });
});

describe('mapStep', () => {
  it('maps basic step data', () => {
    const raw = {
      id: 1,
      name: 'Checkout',
      status: 'completed',
      conclusion: 'success'
    };
    const result = mapStep(raw);
    
    expect(result.id).toBe(1);
    expect(result.name).toBe('Checkout');
    expect(result.status).toBe('completed');
    expect(result.conclusion).toBe('success');
  });

  it('handles alternative id field names', () => {
    let result = mapStep({ number: 5, name: 'Step' });
    expect(result.id).toBe(5);

    result = mapStep({ step_id: 10, name: 'Step' });
    expect(result.id).toBe(10);
  });

  it('handles start_time as alternative to started_at', () => {
    const raw = {
      id: 1,
      name: 'Step',
      start_time: '2024-01-01T00:00:00Z'
    };
    const result = mapStep(raw);
    expect(result.startedAt).toBe('2024-01-01T00:00:00Z');
  });

  it('provides fallback name when missing', () => {
    const raw = { id: 1 };
    const result = mapStep(raw);
    expect(result.name).toBe('Step');
  });

  it('uses title as fallback for name', () => {
    const raw = { id: 1, title: 'Custom Title' };
    const result = mapStep(raw);
    expect(result.name).toBe('Custom Title');
  });
});
