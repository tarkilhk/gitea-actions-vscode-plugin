import * as vscode from 'vscode';

export type DiscoveryMode = 'workspace' | 'pinned' | 'allAccessible';

export interface ExtensionSettings {
  baseUrl: string;
  insecureSkipVerify: boolean;
  discoveryMode: DiscoveryMode;
  runningIntervalSeconds: number;
  idleIntervalSeconds: number;
  maxRunsPerRepo: number;
  maxJobsPerRun: number;
}

export function getSettings(): ExtensionSettings {
  const cfg = vscode.workspace.getConfiguration('giteaActions');
  return {
    baseUrl: cfg.get<string>('baseUrl', '').trim(),
    insecureSkipVerify: cfg.get<boolean>('tls.insecureSkipVerify', false),
    discoveryMode: cfg.get<DiscoveryMode>('discovery.mode', 'workspace'),
    runningIntervalSeconds: cfg.get<number>('refresh.runningIntervalSeconds', 15),
    idleIntervalSeconds: cfg.get<number>('refresh.idleIntervalSeconds', 60),
    maxRunsPerRepo: cfg.get<number>('maxRunsPerRepo', 20),
    maxJobsPerRun: cfg.get<number>('maxJobsPerRun', 50)
  };
}

export function getHostFromBaseUrl(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).host;
  } catch {
    return undefined;
  }
}
