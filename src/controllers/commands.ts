import * as vscode from 'vscode';
import { ActionsNode, JobNode, RepoNode, RunNode } from '../views/nodes';
import { RepoRef } from '../gitea/models';

export type CommandHandlers = {
  setToken: () => Promise<void>;
  clearToken: () => Promise<void>;
  testConnection: () => Promise<void>;
  refresh: () => Promise<void>;
  viewJobLogs: (node: JobNode) => Promise<void>;
  openInBrowser: (node: ActionsNode) => Promise<void>;
  pinRepo: (repo: RepoRef) => Promise<void>;
  unpinRepo: (repo: RepoRef) => Promise<void>;
};

export function registerCommands(context: vscode.ExtensionContext, handlers: CommandHandlers): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('giteaActions.setToken', () => handlers.setToken()),
    vscode.commands.registerCommand('giteaActions.clearToken', () => handlers.clearToken()),
    vscode.commands.registerCommand('giteaActions.testConnection', () => handlers.testConnection()),
    vscode.commands.registerCommand('giteaActions.refresh', () => handlers.refresh()),
    vscode.commands.registerCommand('giteaActions.viewJobLogs', (node: JobNode) => handlers.viewJobLogs(node)),
    vscode.commands.registerCommand('giteaActions.openInBrowser', (node: ActionsNode) => handlers.openInBrowser(node)),
    vscode.commands.registerCommand('giteaActions.pinRepo', (node: RepoNode) => handlers.pinRepo(node.repo)),
    vscode.commands.registerCommand('giteaActions.unpinRepo', (node: RepoNode) => handlers.unpinRepo(node.repo))
  );
}
