/* eslint-disable @typescript-eslint/naming-convention */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockStatusBarItem = {
  text: string;
  tooltip?: string;
  command?: unknown;
  show: () => void;
  dispose: () => void;
};

const createdItems: MockStatusBarItem[] = [];

vi.mock('vscode', () => ({
  window: {
    createStatusBarItem: vi.fn(() => {
      const item: MockStatusBarItem = {
        text: '',
        tooltip: '',
        command: undefined,
        show: vi.fn(),
        dispose: vi.fn()
      };
      createdItems.push(item);
      return item;
    }),
    withProgress: vi.fn(async (_opts, task) => task()),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn()
  },
  StatusBarAlignment: {
    Left: 1
  },
  ProgressLocation: {
    Notification: 1
  },
  Uri: {
    parse: (value: string) => value
  }
}));

import { initStatusBar, updateStatusBar, clearAllPinnedWorkflows } from './statusBarService';
import { WorkflowRun } from '../gitea/models';

describe('statusBarService', () => {
  let mainItem: MockStatusBarItem;

  beforeEach(async () => {
    createdItems.length = 0;
    await clearAllPinnedWorkflows();
    mainItem = initStatusBar() as unknown as MockStatusBarItem;
  });

  describe('failed workflow count', () => {
    it('deduplicates by workflow identity: counts only latest run per workflow', () => {
      const runs: WorkflowRun[] = [
        {
          id: 1,
          name: 'Build',
          workflowName: 'Build',
          status: 'completed',
          conclusion: 'failure',
          updatedAt: '2026-05-07T00:00:00Z'
        },
        {
          id: 2,
          name: 'Build',
          workflowName: 'Build',
          status: 'completed',
          conclusion: 'success',
          updatedAt: '2026-05-07T00:05:00Z'
        },
        {
          id: 3,
          name: 'Release',
          workflowName: 'Release',
          status: 'completed',
          conclusion: 'failure',
          updatedAt: '2026-05-07T00:02:00Z'
        }
      ];

      updateStatusBar(undefined, new Map([['owner/repo', runs]]));

      expect(mainItem.text).toBe('Gitea: 1 failed workflow');
    });

    it('shows 0 failed workflows when all workflows pass', () => {
      const runs: WorkflowRun[] = [
        {
          id: 1,
          name: 'Build',
          workflowName: 'Build',
          status: 'completed',
          conclusion: 'success',
          updatedAt: '2026-05-07T00:00:00Z'
        }
      ];

      updateStatusBar(undefined, new Map([['owner/repo', runs]]));

      expect(mainItem.text).toBe('Gitea: 0 failed workflows');
    });

    it('uses plural form for multiple failed workflows', () => {
      const runs: WorkflowRun[] = [
        {
          id: 1,
          name: 'Build',
          workflowName: 'Build',
          status: 'completed',
          conclusion: 'failure',
          updatedAt: '2026-05-07T00:00:00Z'
        },
        {
          id: 2,
          name: 'Release',
          workflowName: 'Release',
          status: 'completed',
          conclusion: 'failure',
          updatedAt: '2026-05-07T00:01:00Z'
        }
      ];

      updateStatusBar(undefined, new Map([['owner/repo', runs]]));

      expect(mainItem.text).toBe('Gitea: 2 failed workflows');
    });

    it('deduplicates by workflow path (id-based) when workflowPath is set', () => {
      const runs: WorkflowRun[] = [
        {
          id: 1,
          name: 'CI',
          workflowName: 'CI',
          workflowPath: '.gitea/workflows/ci.yml',
          status: 'completed',
          conclusion: 'failure',
          updatedAt: '2026-05-07T00:00:00Z'
        },
        {
          id: 2,
          name: 'CI',
          workflowName: 'CI',
          workflowPath: '.gitea/workflows/ci.yml',
          status: 'completed',
          conclusion: 'success',
          updatedAt: '2026-05-07T00:10:00Z'
        }
      ];

      updateStatusBar(undefined, new Map([['owner/repo', runs]]));

      // Latest run is success, so 0 failures
      expect(mainItem.text).toBe('Gitea: 0 failed workflows');
    });

    it('counts failed workflows independently across repos', () => {
      const runsA: WorkflowRun[] = [
        { id: 1, name: 'CI', workflowName: 'CI', status: 'completed', conclusion: 'failure', updatedAt: '2026-05-07T00:00:00Z' }
      ];
      const runsB: WorkflowRun[] = [
        { id: 2, name: 'CI', workflowName: 'CI', status: 'completed', conclusion: 'failure', updatedAt: '2026-05-07T00:00:00Z' }
      ];

      updateStatusBar(undefined, new Map([['owner/repo-a', runsA], ['owner/repo-b', runsB]]));

      expect(mainItem.text).toBe('Gitea: 2 failed workflows');
    });
  });

  describe('direct text override', () => {
    it('sets text directly and returns early when text argument is provided', () => {
      updateStatusBar('Gitea: loading...');

      expect(mainItem.text).toBe('Gitea: loading...');
    });
  });
});
