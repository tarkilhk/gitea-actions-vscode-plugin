import * as vscode from 'vscode';
import { ActionsNode, JobNode, SecretNode, VariableNode, SecretsRootNode, VariablesRootNode } from '../views/nodes';

export type CommandHandlers = {
  setToken: () => Promise<void>;
  clearToken: () => Promise<void>;
  testConnection: () => Promise<void>;
  refresh: () => Promise<void>;
  viewJobLogs: (node: JobNode) => Promise<void>;
  openInBrowser: (node: ActionsNode) => Promise<void>;
  refreshSecrets: (node: SecretsRootNode) => Promise<void>;
  refreshVariables: (node: VariablesRootNode) => Promise<void>;
  createSecret: (node: SecretsRootNode) => Promise<void>;
  updateSecret: (node: SecretNode) => Promise<void>;
  deleteSecret: (node: SecretNode) => Promise<void>;
  createVariable: (node: VariablesRootNode) => Promise<void>;
  updateVariable: (node: VariableNode) => Promise<void>;
  deleteVariable: (node: VariableNode) => Promise<void>;
  openBaseUrlSettings: () => Promise<void>;
};

export function registerCommands(context: vscode.ExtensionContext, handlers: CommandHandlers): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('giteaActions.setToken', () => handlers.setToken()),
    vscode.commands.registerCommand('giteaActions.clearToken', () => handlers.clearToken()),
    vscode.commands.registerCommand('giteaActions.testConnection', () => handlers.testConnection()),
    vscode.commands.registerCommand('giteaActions.refresh', () => handlers.refresh()),
    vscode.commands.registerCommand('giteaActions.viewJobLogs', (node: JobNode) => handlers.viewJobLogs(node)),
    vscode.commands.registerCommand('giteaActions.openInBrowser', (node: ActionsNode) => handlers.openInBrowser(node)),
    vscode.commands.registerCommand('giteaActions.refreshSecrets', (node: SecretsRootNode) => handlers.refreshSecrets(node)),
    vscode.commands.registerCommand('giteaActions.refreshVariables', (node: VariablesRootNode) => handlers.refreshVariables(node)),
    vscode.commands.registerCommand('giteaActions.createSecret', (node: SecretsRootNode) => handlers.createSecret(node)),
    vscode.commands.registerCommand('giteaActions.updateSecret', (node: SecretNode) => handlers.updateSecret(node)),
    vscode.commands.registerCommand('giteaActions.deleteSecret', (node: SecretNode) => handlers.deleteSecret(node)),
    vscode.commands.registerCommand('giteaActions.createVariable', (node: VariablesRootNode) => handlers.createVariable(node)),
    vscode.commands.registerCommand('giteaActions.updateVariable', (node: VariableNode) => handlers.updateVariable(node)),
    vscode.commands.registerCommand('giteaActions.deleteVariable', (node: VariableNode) => handlers.deleteVariable(node)),
    vscode.commands.registerCommand('giteaActions.openBaseUrlSettings', () => handlers.openBaseUrlSettings())
  );
}
