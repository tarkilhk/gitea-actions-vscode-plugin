/**
 * Mock implementation of the vscode module for unit testing.
 * This allows testing code that imports vscode without running in VS Code.
 */

export const Uri = {
  parse: (value: string) => ({ toString: () => value, scheme: 'file', path: value }),
  file: (path: string) => ({ toString: () => path, scheme: 'file', path })
};

export const ThemeIcon = class ThemeIcon {
  constructor(public id: string, public color?: ThemeColor) {}
};

export const ThemeColor = class ThemeColor {
  constructor(public id: string) {}
};

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2
};

export const TreeItem = class TreeItem {
  label?: string;
  collapsibleState?: number;
  iconPath?: unknown;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  command?: unknown;
  resourceUri?: unknown;
  id?: string;

  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
};

export const EventEmitter = class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  
  fire(data: T) {
    this.listeners.forEach(l => l(data));
  }
  
  dispose() {
    this.listeners = [];
  }
};

export const window = {
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInputBox: async () => undefined,
  withProgress: async <T>(_options: unknown, task: () => Promise<T>) => task(),
  createStatusBarItem: () => ({
    show: () => {},
    hide: () => {},
    dispose: () => {},
    text: '',
    tooltip: '',
    command: ''
  }),
  createTreeView: () => ({
    onDidExpandElement: { event: () => ({ dispose: () => {} }) },
    onDidChangeVisibility: { event: () => ({ dispose: () => {} }) },
    dispose: () => {}
  }),
  createOutputChannel: () => ({
    appendLine: () => {},
    append: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {}
  })
};

export const workspace = {
  getConfiguration: () => ({
    get: <T>(key: string, defaultValue: T) => defaultValue
  }),
  workspaceFolders: [],
  registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
  onDidCloseTextDocument: { event: () => ({ dispose: () => {} }) },
  onDidChangeConfiguration: { event: () => ({ dispose: () => {} }) },
  openTextDocument: async () => ({})
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => {}
};

export const env = {
  openExternal: async () => true
};

export const languages = {
  setTextDocumentLanguage: async () => ({})
};

export const StatusBarAlignment = {
  Left: 1,
  Right: 2
};

export const ProgressLocation = {
  Notification: 15,
  SourceControl: 1,
  Window: 10
};

export default {
  Uri,
  ThemeIcon,
  ThemeColor,
  TreeItemCollapsibleState,
  TreeItem,
  EventEmitter,
  window,
  workspace,
  commands,
  env,
  languages,
  StatusBarAlignment,
  ProgressLocation
};
