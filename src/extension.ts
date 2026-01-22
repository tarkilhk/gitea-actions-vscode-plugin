import * as vscode from 'vscode';
import { getSettings, ExtensionSettings } from './config/settings';
import { getToken } from './config/secrets';
import { WorkflowRun, Job, Step, toRunRef, RunRef } from './gitea/models';
import { ActionsTreeProvider } from './views/actionsTreeProvider';
import { SettingsTreeProvider } from './views/settingsTreeProvider';
import { ActionsNode } from './views/nodes';
import { registerCommands } from './controllers/commands';
import { RefreshController } from './controllers/refreshController';
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
  openInBrowser
} from './commands/runCommands';

// Services
import {
  LiveLogContentProvider,
  buildLogUri,
  buildStepLogUri,
  stopLogStream,
  startLogStream,
  startStepLogStream,
  fetchStepLogs,
  isJobActive,
  isStepActive
} from './services/logStreamService';
import {
  initStatusBar,
  showToast,
  updateStatusBar
} from './services/statusBarService';
import {
  RefreshServiceState,
  resetRefreshCaches,
  refreshAll,
  getConfigError,
  getConfigErrors,
  ensureApi,
  ensureInternalApi,
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
let windowFocused = true;
let workspaceVisible = true;
let pinnedVisible = true;
let settingsVisible = true;
let pollingEnabled = true;
const lastRunsByRepo = new Map<string, WorkflowRun[]>();
const workflowNameCache = new Map<string, Map<string, string>>();
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
  windowFocused = vscode.window.state.focused;
  workspaceVisible = workspaceTree.visible;
  pinnedVisible = pinnedTree.visible;
  settingsVisible = settingsTree.visible;
  context.subscriptions.push(
    workspaceTree.onDidExpandElement((e) => {
      workspaceProvider.markExpanded(e.element);
      handleExpand(e.element);
    }),
    workspaceTree.onDidCollapseElement((e) => {
      workspaceProvider.markCollapsed(e.element);
    }),
    pinnedTree.onDidExpandElement((e) => {
      pinnedProvider.markExpanded(e.element);
      handleExpand(e.element);
    }),
    pinnedTree.onDidCollapseElement((e) => {
      pinnedProvider.markCollapsed(e.element);
    })
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
    refreshSecrets: (node) => refreshSecrets(node, createSecretContext()),
    refreshVariables: (node) => refreshVariables(node, createVariableContext()),
    createSecret: (node) => createSecret(node, createSecretContext()),
    updateSecret: (node) => updateSecret(node, createSecretContext()),
    deleteSecret: (node) => deleteSecret(node, createSecretContext()),
    createVariable: (node) => createVariable(node, createVariableContext()),
    updateVariable: (node) => updateVariable(node, createVariableContext()),
    deleteVariable: (node) => deleteVariable(node, createVariableContext()),
    openBaseUrlSettings: () => openBaseUrlSettings(),
    openSettings: () => openSettings()
  });

  // Configuration change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('giteaActions')) {
        settings = getSettings();
        resetRefreshCaches(getRefreshState());
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
  updatePollingState();

  // Refresh when views become visible
  context.subscriptions.push(
    workspaceTree.onDidChangeVisibility((e) => {
      workspaceVisible = e.visible;
      updatePollingState();
      if (e.visible) {
        void doRefresh();
      }
    }),
    pinnedTree.onDidChangeVisibility((e) => {
      pinnedVisible = e.visible;
      updatePollingState();
      if (e.visible) {
        void doRefresh();
      }
    }),
    settingsTree.onDidChangeVisibility((e) => {
      settingsVisible = e.visible;
      updatePollingState();
      if (e.visible) {
        void doRefresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      windowFocused = e.focused;
      updatePollingState();
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

function createLogStreamContext() {
  const state = getRefreshState();
  const stepLogDeps = {
    logContentProvider,
    getSettings: () => settings
  };
  return {
    getConfigError: () => getConfigError(state),
    ensureApi: () => ensureApi(state),
    ensureInternalApi: () => ensureInternalApi(state),
    logContentProvider,
    startLogStream: (api: import('./gitea/api').GiteaApi, uri: vscode.Uri, runRef: RunRef | undefined, jobId: number | string) =>
      startLogStream(api, uri, runRef, jobId, {
        logContentProvider,
        getSettings: () => settings,
        updateJobs: (r, rid, jobs) => {
          workspaceProvider.updateJobs(r, rid, jobs);
          pinnedProvider.updateJobs(r, rid, jobs);
        },
        hydrateJobSteps: (ref, jobs) => hydrateJobSteps(ref, jobs, state),
        scheduleJobRefresh: (ref, jobs) => scheduleJobRefresh(ref, jobs, state, settings)
      }),
    fetchStepLogs: (internalApi: import('./gitea/internalApi').GiteaInternalApi, uri: vscode.Uri, runRef: RunRef, jobIndex: number, stepIndex: number, totalSteps: number) =>
      fetchStepLogs(internalApi, uri, runRef, jobIndex, stepIndex, totalSteps, stepLogDeps),
    startStepLogStream: (internalApi: import('./gitea/internalApi').GiteaInternalApi, uri: vscode.Uri, runRef: RunRef, jobIndex: number, stepIndex: number, totalSteps: number, isActive: () => boolean) =>
      startStepLogStream(internalApi, uri, runRef, jobIndex, stepIndex, totalSteps, isActive, stepLogDeps),
    buildLogUri,
    buildStepLogUri,
    isJobActive,
    isStepActive
  };
}

// Helper functions
async function openBaseUrlSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', '@giteaActions');
}

async function openSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', '@giteaActions');
}

async function manualRefresh(): Promise<void> {
  resetRefreshCaches(getRefreshState());
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
  
  // Note: Expansion state is preserved automatically by VS Code through stable node IDs.
  // We track expansion state in the provider for potential future use, but we don't
  // actively restore it via reveal() to avoid focus shifts when the user is working elsewhere.
  
  return result;
}

function scheduleRefresh(): void {
  refreshController?.stop();
  if (shouldPoll()) {
    refreshController?.start();
  }
}

async function handleExpand(element: ActionsNode): Promise<void> {
  if (!element) {
    return;
  }
  if (element.type === 'run') {
    const state = getRefreshState();
    // Pass the actual expanded RunNode instance for proper UI refresh
    await fetchJobsForRun(toRunRef(element.repo, element.run), state, settings, { runNode: element });
  }
}

function shouldPoll(): boolean {
  return windowFocused || workspaceVisible || pinnedVisible || settingsVisible;
}

function updatePollingState(): void {
  const nextEnabled = shouldPoll();
  if (nextEnabled === pollingEnabled) {
    return;
  }
  pollingEnabled = nextEnabled;
  if (pollingEnabled) {
    refreshController?.start();
  } else {
    refreshController?.stop();
  }
}
