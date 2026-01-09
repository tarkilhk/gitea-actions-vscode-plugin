import * as vscode from 'vscode';
import { getSettings, ExtensionSettings } from './config/settings';
import { getToken } from './config/secrets';
import { PinnedRepo, WorkflowRun, Job, Step } from './gitea/models';
import { ActionsTreeProvider } from './views/actionsTreeProvider';
import { SettingsTreeProvider } from './views/settingsTreeProvider';
import { ActionsNode } from './views/nodes';
import { registerCommands } from './controllers/commands';
import { RefreshController } from './controllers/refreshController';
import { loadPinned } from './gitea/discovery';
import { setVerboseLogging } from './util/logging';

// Commands
import {
  setTokenCommand,
  clearTokenCommand,
  testConnectionCommand
} from './commands/tokenCommands';
import {
  refreshSecrets,
  createSecret,
  updateSecret,
  deleteSecret,
  refreshSecretsForRepo
} from './commands/secretCommands';
import {
  refreshVariables,
  createVariable,
  updateVariable,
  deleteVariable,
  refreshVariablesForRepo
} from './commands/variableCommands';
import {
  viewJobLogs,
  openInBrowser,
  pinRepo,
  unpinRepo
} from './commands/runCommands';

// Services
import {
  LiveLogContentProvider,
  buildLogUri,
  stopLogStream,
  startLogStream,
  isJobActive
} from './services/logStreamService';
import {
  initStatusBar,
  showToast,
  updateStatusBar
} from './services/statusBarService';
import {
  RefreshServiceState,
  refreshAll,
  getConfigError,
  getConfigErrors,
  ensureApi,
  hydrateJobSteps,
  scheduleJobRefresh,
  fetchJobsForRun
} from './services/refreshService';

// Module-level state
let settings: ExtensionSettings;
let cachedToken: string | undefined;
let secretStorage: vscode.SecretStorage;
const workspaceProvider = new ActionsTreeProvider('runs');
const pinnedProvider = new ActionsTreeProvider('workflows');
const settingsProvider = new SettingsTreeProvider();
let workspaceTree: vscode.TreeView<ActionsNode>;
let pinnedTree: vscode.TreeView<ActionsNode>;
let settingsTree: vscode.TreeView<ActionsNode>;
let refreshController: RefreshController | undefined;
const lastRunsByRepo = new Map<string, WorkflowRun[]>();
const workflowNameCache = new Map<string, Map<string, string>>();
let pinnedRepos: PinnedRepo[] = [];
const inFlightJobFetch = new Map<string, Promise<Job[] | undefined>>();
const jobRefreshTimers = new Map<string, NodeJS.Timeout>();
const jobStepsCache = new Map<string, Step[]>();

const logContentProvider = new LiveLogContentProvider();

/**
 * Gets the current refresh service state.
 */
function getRefreshState(): RefreshServiceState {
  return {
    settings,
    cachedToken,
    secretStorage,
    pinnedRepos,
    workspaceProvider,
    pinnedProvider,
    settingsProvider,
    lastRunsByRepo,
    workflowNameCache,
    inFlightJobFetch,
    jobRefreshTimers,
    jobStepsCache
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  setVerboseLogging(true);
  settings = getSettings();
  secretStorage = context.secrets;
  cachedToken = await getToken(secretStorage);
  pinnedRepos = await loadPinned(context.globalState);

  // Initialize tree views
  workspaceTree = vscode.window.createTreeView('giteaActions.runs', {
    treeDataProvider: workspaceProvider,
    showCollapseAll: true
  });
  pinnedTree = vscode.window.createTreeView('giteaActions.runsPinned', {
    treeDataProvider: pinnedProvider,
    showCollapseAll: true
  });
  settingsTree = vscode.window.createTreeView('giteaActions.settings', {
    treeDataProvider: settingsProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(workspaceTree, pinnedTree, settingsTree);
  context.subscriptions.push(
    workspaceTree.onDidExpandElement((e) => handleExpand(e.element)),
    pinnedTree.onDidExpandElement((e) => handleExpand(e.element))
  );

  // Initialize status bar
  const statusBar = initStatusBar();
  context.subscriptions.push(statusBar);

  // Register log content provider
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('gitea-actions-log', logContentProvider),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === 'gitea-actions-log') {
        stopLogStream(doc.uri);
      }
    })
  );

  // Register commands
  registerCommands(context, {
    setToken: () => setTokenCommand(context, createTokenContext()),
    clearToken: () => clearTokenCommand(context, createTokenContext(), !!cachedToken),
    testConnection: () => testConnectionCommand(createTokenContext()),
    refresh: () => manualRefresh(),
    viewJobLogs: (node) => viewJobLogs(node, createLogStreamContext()),
    openInBrowser: (node) => openInBrowser(node),
    pinRepo: (repo) => pinRepo(context, repo, createRunContext()),
    unpinRepo: (repo) => unpinRepo(context, repo, createRunContext()),
    refreshSecrets: (node) => refreshSecrets(node, createSecretContext()),
    refreshVariables: (node) => refreshVariables(node, createVariableContext()),
    createSecret: (node) => createSecret(node, createSecretContext()),
    updateSecret: (node) => updateSecret(node, createSecretContext()),
    deleteSecret: (node) => deleteSecret(node, createSecretContext()),
    createVariable: (node) => createVariable(node, createVariableContext()),
    updateVariable: (node) => updateVariable(node, createVariableContext()),
    deleteVariable: (node) => deleteVariable(node, createVariableContext()),
    openBaseUrlSettings: () => openBaseUrlSettings()
  });

  // Configuration change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('giteaActions')) {
        settings = getSettings();
        scheduleRefresh();
      }
    })
  );

  // Initialize refresh controller
  refreshController = new RefreshController(() => doRefresh(), () => ({
    runningSeconds: settings.runningIntervalSeconds,
    idleSeconds: settings.idleIntervalSeconds
  }));
  context.subscriptions.push(refreshController);
  refreshController.start();

  // Refresh when views become visible
  context.subscriptions.push(
    workspaceTree.onDidChangeVisibility((e) => {
      if (e.visible) {
        void doRefresh();
      }
    }),
    settingsTree.onDidChangeVisibility((e) => {
      if (e.visible) {
        void doRefresh();
      }
    })
  );
  
  // Initialize token status
  settingsProvider.setTokenStatus(!!cachedToken);
}

export function deactivate(): void {
  refreshController?.dispose();
}

// Context factory functions
function createTokenContext() {
  return {
    showToast,
    getConfigError: () => getConfigError(getRefreshState()),
    ensureApi: () => ensureApi(getRefreshState()),
    onTokenChanged: (token: string | undefined) => {
      cachedToken = token;
      settingsProvider.setTokenStatus(!!token);
      if (!token) {
        workspaceProvider.clear();
        pinnedProvider.clear();
        void getConfigErrors(getRefreshState()).then((errors) => {
          if (errors.length > 0) {
            workspaceProvider.setConfigErrors(errors);
            pinnedProvider.setConfigErrors(errors);
          }
        });
        void getConfigError(getRefreshState()).then((error) => {
          if (error) {
            updateStatusBar('Gitea: not configured');
          } else {
            updateStatusBar(undefined, lastRunsByRepo);
          }
        });
      }
    },
    scheduleRefresh
  };
}

function createSecretContext() {
  return {
    showToast,
    getConfigError: () => getConfigError(getRefreshState()),
    ensureApi: () => ensureApi(getRefreshState()),
    settingsProvider
  };
}

function createVariableContext() {
  return {
    showToast,
    getConfigError: () => getConfigError(getRefreshState()),
    ensureApi: () => ensureApi(getRefreshState()),
    settingsProvider
  };
}

function createRunContext() {
  return {
    showToast,
    getConfigError: () => getConfigError(getRefreshState()),
    ensureApi: () => ensureApi(getRefreshState()),
    scheduleRefresh,
    getPinnedRepos: () => pinnedRepos,
    setPinnedRepos: (repos: PinnedRepo[]) => { pinnedRepos = repos; }
  };
}

function createLogStreamContext() {
  const state = getRefreshState();
  return {
    getConfigError: () => getConfigError(state),
    ensureApi: () => ensureApi(state),
    logContentProvider,
    startLogStream: (api: import('./gitea/api').GiteaApi, uri: vscode.Uri, repo: import('./gitea/models').RepoRef, runId: number | string | undefined, jobId: number | string) =>
      startLogStream(api, uri, repo, runId, jobId, {
        logContentProvider,
        getSettings: () => settings,
        updateJobs: (r, rid, jobs) => {
          workspaceProvider.updateJobs(r, rid, jobs);
          pinnedProvider.updateJobs(r, rid, jobs);
        },
        hydrateJobSteps: (api, r, rid, jobs) => hydrateJobSteps(api, r, rid, jobs, state),
        scheduleJobRefresh: (r, rid, jobs) => scheduleJobRefresh(r, rid, jobs, state, settings)
      }),
    buildLogUri,
    isJobActive
  };
}

// Helper functions
async function openBaseUrlSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', '@giteaActions');
}

async function manualRefresh(): Promise<void> {
  await doRefresh();
}

async function doRefresh(): Promise<boolean> {
  const state = getRefreshState();
  const result = await refreshAll(state);
  // Sync state back
  cachedToken = state.cachedToken;
  
  // Also refresh secrets and variables for settings view
  const repo = settingsProvider.getCurrentRepo();
  if (repo) {
    void refreshSecretsForRepo(repo, createSecretContext());
    void refreshVariablesForRepo(repo, createVariableContext());
  }
  
  return result;
}

function scheduleRefresh(): void {
  refreshController?.stop();
  refreshController?.start();
}

async function handleExpand(element: ActionsNode): Promise<void> {
  if (!element) {
    return;
  }
  if (element.type === 'run') {
    const state = getRefreshState();
    await fetchJobsForRun(element.repo, element.run.id, state, settings);
  }
}
