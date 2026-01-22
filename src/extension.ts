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

async function manualRefresh(): Promise<void> {
  await doRefresh();
}

async function doRefresh(): Promise<boolean> {
  // Save expansion state before refresh
  const workspaceExpandedIds = workspaceProvider.getExpandedNodeIds();
  const pinnedExpandedIds = pinnedProvider.getExpandedNodeIds();
  
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
  
  // Restore expansion state after refresh
  // Use setTimeout to ensure tree has been rebuilt
  setTimeout(() => {
    restoreExpansionState(workspaceTree, workspaceProvider, workspaceExpandedIds);
    restoreExpansionState(pinnedTree, pinnedProvider, pinnedExpandedIds);
  }, 100);
  
  return result;
}

/**
 * Restores expansion state for a tree view after refresh.
 * Uses reveal() with expand option to restore each previously expanded node.
 */
function restoreExpansionState(
  treeView: vscode.TreeView<ActionsNode>,
  provider: ActionsTreeProvider,
  expandedIds: Set<string>
): void {
  if (expandedIds.size === 0) {
    return;
  }
  
  // Restore expansion state for each previously expanded node
  // We use reveal() which requires getParent() to be implemented
  for (const id of expandedIds) {
    const node = provider.findNodeById(id);
    if (node) {
      // Use reveal with expand option to restore expansion state
      // select: false and focus: false prevent unwanted UI changes
      // Thenable doesn't have catch, so we use then with no-op error handler
      void treeView.reveal(node, { expand: true, select: false, focus: false }).then(
        () => {},
        () => {
          // Ignore errors if node is no longer available (e.g., removed during refresh)
        }
      );
    }
  }
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
    await fetchJobsForRun(toRunRef(element.repo, element.run), state, settings);
  }
}
