import * as vscode from 'vscode';
import {
  ActionsNode,
  ConfigRootNode,
  ConfigActionNode,
  TokenNode,
  SecretsRootNode,
  SecretNode,
  VariablesRootNode,
  VariableNode,
  MessageNode,
  toTreeItem
} from './nodes';
import { RepoRef } from '../gitea/models';
import { Secret, ActionVariable } from '../gitea/api';

export class SettingsTreeProvider implements vscode.TreeDataProvider<ActionsNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ActionsNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private currentRepo: RepoRef | undefined;
  private secrets: Secret[] = [];
  private variables: ActionVariable[] = [];
  private secretsState: 'idle' | 'loading' | 'error' = 'idle';
  private variablesState: 'idle' | 'loading' | 'error' = 'idle';
  private secretsError?: string;
  private variablesError?: string;
  private hasToken: boolean = false;

  getTreeItem(element: ActionsNode): vscode.TreeItem {
    return toTreeItem(element);
  }

  getChildren(element?: ActionsNode): vscode.ProviderResult<ActionsNode[]> {
    if (!element) {
      if (!this.currentRepo) {
        return [
          {
            type: 'message',
            message: 'Open a Gitea repository to view settings',
            severity: 'info'
          } satisfies MessageNode
        ];
      }

      return [
        {
          type: 'secretsRoot',
          repo: this.currentRepo
        } satisfies SecretsRootNode,
        {
          type: 'variablesRoot',
          repo: this.currentRepo
        } satisfies VariablesRootNode,
        {
          type: 'configRoot',
          repo: this.currentRepo
        } satisfies ConfigRootNode as ConfigRootNode
      ];
    }

    if (element.type === 'secretsRoot') {
      if (this.secretsState === 'loading') {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: 'Loading secrets...',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      if (this.secretsState === 'error') {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: this.secretsError ?? 'Failed to load secrets',
            severity: 'error'
          } satisfies MessageNode
        ];
      }
      if (this.secrets.length === 0) {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: 'No secrets defined',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      return this.secrets.map<SecretNode>((secret) => ({
        type: 'secret',
        repo: element.repo,
        name: secret.name,
        description: secret.description,
        createdAt: secret.createdAt
      }));
    }

    if (element.type === 'configRoot') {
      return [
        {
          type: 'token',
          hasToken: this.hasToken
        } satisfies TokenNode,
        {
          type: 'configAction',
          action: 'testConnection'
        } satisfies ConfigActionNode,
        {
          type: 'configAction',
          action: 'openSettings'
        } satisfies ConfigActionNode
      ];
    }

    if (element.type === 'variablesRoot') {
      if (this.variablesState === 'loading') {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: 'Loading variables...',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      if (this.variablesState === 'error') {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: this.variablesError ?? 'Failed to load variables',
            severity: 'error'
          } satisfies MessageNode
        ];
      }
      if (this.variables.length === 0) {
        return [
          {
            type: 'message',
            repo: element.repo,
            message: 'No repository variables defined',
            severity: 'info'
          } satisfies MessageNode
        ];
      }
      return this.variables.map<VariableNode>((variable) => ({
        type: 'variable',
        repo: element.repo,
        name: variable.name,
        description: variable.description,
        value: variable.data
      }));
    }

    return [];
  }

  getCurrentRepo(): RepoRef | undefined {
    return this.currentRepo;
  }

  setRepository(repo: RepoRef | undefined): void {
    this.currentRepo = repo;
    if (!repo) {
      this.secrets = [];
      this.variables = [];
    }
    this.refresh();
  }

  setTokenStatus(hasToken: boolean): void {
    this.hasToken = hasToken;
    this.refresh();
  }

  setSecrets(secrets: Secret[]): void {
    this.secrets = secrets;
    this.secretsState = 'idle';
    this.secretsError = undefined;
    this.refresh();
  }

  setSecretsLoading(): void {
    this.secretsState = 'loading';
    this.secretsError = undefined;
    this.refresh();
  }

  setSecretsError(error: string): void {
    this.secretsState = 'error';
    this.secretsError = error;
    this.refresh();
  }

  setVariables(variables: ActionVariable[]): void {
    this.variables = variables;
    this.variablesState = 'idle';
    this.variablesError = undefined;
    this.refresh();
  }

  setVariablesLoading(): void {
    this.variablesState = 'loading';
    this.variablesError = undefined;
    this.refresh();
  }

  setVariablesError(error: string): void {
    this.variablesState = 'error';
    this.variablesError = error;
    this.refresh();
  }

  refresh(node?: ActionsNode): void {
    if (!node) {
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }
    this.onDidChangeTreeDataEmitter.fire(node);
  }
}