import * as vscode from 'vscode';
import { GiteaApi } from '../gitea/api';
import { RepoRef } from '../gitea/models';
import { SecretsRootNode, SecretNode } from '../views/nodes';
import { logError, logWarn } from '../util/logging';
import { SettingsTreeProvider } from '../views/settingsTreeProvider';

export type SecretCommandContext = {
  showToast: (message: string, type?: 'info' | 'warning' | 'error') => void;
  getConfigError: () => Promise<string | undefined>;
  ensureApi: () => Promise<GiteaApi | undefined>;
  settingsProvider: SettingsTreeProvider;
};

export async function refreshSecretsForRepo(
  repo: RepoRef,
  ctx: SecretCommandContext
): Promise<void> {
  const error = await ctx.getConfigError();
  if (error) {
    ctx.settingsProvider.setSecretsError(error);
    return;
  }
  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }
  
  ctx.settingsProvider.setSecretsLoading();
  try {
    const secrets = await api.listSecrets(repo);
    ctx.settingsProvider.setSecrets(secrets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.settingsProvider.setSecretsError(message);
    logWarn(`Failed to refresh secrets for ${repo.owner}/${repo.name}: ${message}`);
  }
}

export async function refreshSecrets(
  node: SecretsRootNode,
  ctx: SecretCommandContext
): Promise<void> {
  await refreshSecretsForRepo(node.repo, ctx);
}

export async function createSecret(
  node: SecretsRootNode,
  ctx: SecretCommandContext
): Promise<void> {
  const error = await ctx.getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before creating secrets.`);
    return;
  }
  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }
  
  const name = await vscode.window.showInputBox({
    prompt: 'Secret name',
    placeHolder: 'SECRET_NAME',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Secret name cannot be empty';
      }
      if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) {
        return 'Secret name should be uppercase letters, numbers, and underscores only';
      }
      return undefined;
    }
  });
  
  if (!name) {
    return;
  }
  
  const data = await vscode.window.showInputBox({
    prompt: 'Secret value',
    placeHolder: 'Enter secret value',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (!value.trim() ? 'Secret value cannot be empty' : undefined)
  });
  
  if (!data) {
    return;
  }
  
  const description = await vscode.window.showInputBox({
    prompt: 'Description (optional)',
    placeHolder: 'Optional description'
  });
  
  try {
    await api.createOrUpdateSecret(node.repo, name.trim(), data.trim(), description?.trim());
    ctx.showToast(`Secret ${name} created successfully.`);
    await refreshSecretsForRepo(node.repo, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create secret: ${message}`);
    logError('Failed to create secret', error);
  }
}

export async function updateSecret(
  node: SecretNode,
  ctx: SecretCommandContext
): Promise<void> {
  const error = await ctx.getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before updating secrets.`);
    return;
  }
  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }
  
  const data = await vscode.window.showInputBox({
    prompt: 'New secret value',
    placeHolder: 'Enter new secret value',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (!value.trim() ? 'Secret value cannot be empty' : undefined)
  });
  
  if (!data) {
    return;
  }
  
  const description = await vscode.window.showInputBox({
    prompt: 'Description (optional)',
    placeHolder: node.description || 'Optional description',
    value: node.description
  });
  
  try {
    await api.createOrUpdateSecret(node.repo, node.name, data.trim(), description?.trim());
    ctx.showToast(`Secret ${node.name} updated successfully.`);
    await refreshSecretsForRepo(node.repo, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to update secret: ${message}`);
    logError('Failed to update secret', error);
  }
}

export async function deleteSecret(
  node: SecretNode,
  ctx: SecretCommandContext
): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `Delete secret "${node.name}"? This action cannot be undone.`,
    { modal: true },
    'Delete'
  );
  
  if (confirmed !== 'Delete') {
    return;
  }
  
  const error = await ctx.getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before deleting secrets.`);
    return;
  }
  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }
  
  try {
    await api.deleteSecret(node.repo, node.name);
    ctx.showToast(`Secret ${node.name} deleted successfully.`);
    await refreshSecretsForRepo(node.repo, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to delete secret: ${message}`);
    logError('Failed to delete secret', error);
  }
}
