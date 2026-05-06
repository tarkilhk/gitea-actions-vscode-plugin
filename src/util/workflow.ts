import { WorkflowRun } from '../gitea/models';

export function workflowIdFromPath(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }
  const beforeAt = path.split('@')[0] ?? path;
  const parts = beforeAt.split('/');
  const file = parts[parts.length - 1];
  return file || undefined;
}

export function workflowIdentity(run: Pick<WorkflowRun, 'workflowPath' | 'workflowName' | 'name'>): string {
  const workflowId = workflowIdFromPath(run.workflowPath);
  if (workflowId) {
    return `id:${workflowId}`;
  }
  return `name:${run.workflowName ?? run.name}`;
}
