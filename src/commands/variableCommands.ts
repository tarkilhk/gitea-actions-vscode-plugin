import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { RepoRef } from '../gitea/models';
import { VariablesRootNode, VariableNode } from '../views/nodes';
import { logError, logWarn } from '../util/logging';
import { SettingsTreeProvider } from '../views/settingsTreeProvider';
import { normalizeEscapedNewlines } from '../util/inputNormalization';
import { promptValueForm } from '../ui/valueForm';

export type VariableCommandContext = {
  showToast: (message: string, type?: 'info' | 'warning' | 'error') => void;
  getConfigError: () => Promise<string | undefined>;
  ensureApi: () => Promise<GiteaApi | undefined>;
  settingsProvider: SettingsTreeProvider;
};

export async function refreshVariablesForRepo(
  repo: RepoRef,
  ctx: VariableCommandContext
): Promise<void> {
  const error = await ctx.getConfigError();
  if (error) {
    ctx.settingsProvider.setVariablesError(error);
    return;
  }
  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }
  
  ctx.settingsProvider.setVariablesLoading();
  try {
    const variables = await api.listVariables(repo);
    ctx.settingsProvider.setVariables(variables);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.settingsProvider.setVariablesError(message);
    logWarn(`Failed to refresh variables for ${repo.owner}/${repo.name}: ${message}`);
  }
}

export async function refreshVariables(
  node: VariablesRootNode,
  ctx: VariableCommandContext
): Promise<void> {
  await refreshVariablesForRepo(node.repo, ctx);
}

export async function createVariable(
  node: VariablesRootNode,
  ctx: VariableCommandContext
): Promise<void> {
  const error = await ctx.getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before creating variables.`);
    return;
  }
  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }
  
  const form = await promptValueForm({
    title: 'Create Variable',
    submitLabel: 'Create Variable',
    includeName: true,
    nameLabel: 'Variable name',
    namePlaceholder: 'VARIABLE_NAME',
    descriptionLabel: 'Description (optional)',
    descriptionPlaceholder: 'Optional description',
    valueLabel: 'Variable value',
    valuePlaceholder: 'Enter variable value',
    isSecret: false
  });
  
  if (!form || !form.name) {
    return;
  }
  
  try {
    await api.createVariable(
      node.repo,
      form.name,
      normalizeEscapedNewlines(form.value),
      form.description
    );
    ctx.showToast(`Variable ${form.name} created successfully.`);
    await refreshVariablesForRepo(node.repo, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create variable: ${message}`);
    logError('Failed to create variable', error);
  }
}

export async function updateVariable(
  node: VariableNode,
  ctx: VariableCommandContext
): Promise<void> {
  const error = await ctx.getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before updating variables.`);
    return;
  }
  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }
  
  // Get current value from API
  let currentValue = node.value;
  if (!currentValue) {
    try {
      const variable = await api.getVariable(node.repo, node.name);
      currentValue = variable.data;
    } catch (error) {
      logWarn(`Failed to fetch current variable value: ${String(error)}`);
    }
  }
  
  const form = await promptValueForm({
    title: 'Update Variable',
    submitLabel: 'Update Variable',
    includeName: false,
    nameLabel: 'Variable name',
    namePlaceholder: '',
    descriptionLabel: 'Description (optional)',
    descriptionPlaceholder: 'Optional description',
    descriptionValue: node.description,
    valueLabel: 'Variable value',
    valuePlaceholder: 'Enter new variable value',
    valueValue: currentValue,
    isSecret: false
  });
  
  if (!form) {
    return;
  }
  
  try {
    await api.updateVariable(
      node.repo,
      node.name,
      normalizeEscapedNewlines(form.value),
      form.description
    );
    ctx.showToast(`Variable ${node.name} updated successfully.`);
    await refreshVariablesForRepo(node.repo, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to update variable: ${message}`);
    logError('Failed to update variable', error);
  }
}

export async function deleteVariable(
  node: VariableNode,
  ctx: VariableCommandContext
): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `Delete variable "${node.name}"? This action cannot be undone.`,
    { modal: true },
    'Delete'
  );
  
  if (confirmed !== 'Delete') {
    return;
  }
  
  const error = await ctx.getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before deleting variables.`);
    return;
  }
  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }
  
  try {
    await api.deleteVariable(node.repo, node.name);
    ctx.showToast(`Variable ${node.name} deleted successfully.`);
    await refreshVariablesForRepo(node.repo, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to delete variable: ${message}`);
    logError('Failed to delete variable', error);
  }
}
