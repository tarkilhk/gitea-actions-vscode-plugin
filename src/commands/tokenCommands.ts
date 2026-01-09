import * as vscode from 'vscode';
import { clearToken, promptForToken, storeToken } from '../config/secrets';
import { GiteaApi } from '../gitea/api';
import { logError } from '../util/logging';

export type TokenCommandContext = {
  showToast: (message: string, type?: 'info' | 'warning' | 'error') => void;
  getConfigError: () => Promise<string | undefined>;
  ensureApi: () => Promise<GiteaApi | undefined>;
  onTokenChanged: (token: string | undefined) => void;
  scheduleRefresh: () => void;
};

export async function setTokenCommand(
  context: vscode.ExtensionContext,
  ctx: TokenCommandContext
): Promise<void> {
  const token = await promptForToken();
  if (!token) {
    return;
  }
  await storeToken(context.secrets, token);
  ctx.onTokenChanged(token);
  ctx.showToast('Gitea token saved.');
  ctx.scheduleRefresh();
}

export async function clearTokenCommand(
  context: vscode.ExtensionContext,
  ctx: TokenCommandContext,
  hadToken: boolean
): Promise<void> {
  await clearToken(context.secrets);
  ctx.onTokenChanged(undefined);
  
  if (hadToken) {
    ctx.showToast('Gitea token cleared.');
  }
}

export async function testConnectionCommand(ctx: TokenCommandContext): Promise<void> {
  const error = await ctx.getConfigError();
  if (error) {
    vscode.window.showWarningMessage(`${error} before testing.`);
    return;
  }
  const api = await ctx.ensureApi();
  if (!api) {
    return;
  }
  try {
    const version = await api.testConnection();
    ctx.showToast(`Connected to Gitea (version ${version}).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Connection failed: ${message}`);
    logError('Connection test failed', error);
  }
}
