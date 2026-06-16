import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { ActionsNode, WorkflowGroupNode } from '../views/nodes';
import { workflowIdFromPath } from '../util/workflow';

export type WorkflowCommandContext = {
  showToast: (message: string, type?: 'info' | 'warning' | 'error') => void;
  getConfigError: () => Promise<string | undefined>;
  ensureApi: () => Promise<GiteaApi | undefined>;
  scheduleRefresh: () => void;
};

export async function dispatchWorkflow(node: ActionsNode, ctx: WorkflowCommandContext): Promise<void> {
  if (node.type !== 'workflowGroup') {
    return;
  }

  const workflowGroup = node as WorkflowGroupNode;
  const latestRun = workflowGroup.runs[0];

  const error = await ctx.getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`Cannot dispatch workflow; ${error.toLowerCase()} first.`);
    return;
  }

  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }

  const workflowId = workflowIdFromPath(latestRun?.workflowPath);
  if (!workflowId) {
    ctx.showToast('Cannot dispatch workflow: missing workflow ID.', 'warning');
    return;
  }

  const workflowName = latestRun?.workflowName ?? latestRun?.name ?? workflowId;

  try {
    const defaultBranch = await api.getDefaultBranch(workflowGroup.repo);
    const ref = `refs/heads/${defaultBranch}`;
    await api.dispatchWorkflow(workflowGroup.repo, workflowId, { ref });
    ctx.showToast(`Dispatched ${workflowName} on ${defaultBranch}.`, 'info');
    ctx.scheduleRefresh();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.showToast(`Failed to dispatch workflow: ${message}`, 'error');
  }
}
