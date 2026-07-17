import * as vscode from 'vscode';

export type DiscoveryMode = 'workspace' | 'allAccessible';

export interface ExtensionSettings {
  baseUrl: string;
  insecureSkipVerify: boolean;
  discoveryMode: DiscoveryMode;
  runningIntervalSeconds: number;
  idleIntervalSeconds: number;
  jobsIntervalSeconds: number;
  logPollIntervalSeconds: number;
  maxRunsPerRepo: number;
  maxRunsPerWorkflow: number;
  maxJobsPerRun: number;
  verboseLogging: boolean;
}

export function getSettings(): ExtensionSettings {
  const cfg = vscode.workspace.getConfiguration('giteaActions');
  return {
    baseUrl: cfg.get<string>('baseUrl', '').trim(),
    insecureSkipVerify: cfg.get<boolean>('tls.insecureSkipVerify', false),
    discoveryMode: cfg.get<DiscoveryMode>('discovery.mode', 'workspace'),
    runningIntervalSeconds: cfg.get<number>('refresh.runningIntervalSeconds', 15),
    idleIntervalSeconds: cfg.get<number>('refresh.idleIntervalSeconds', 15),
    jobsIntervalSeconds: cfg.get<number>('refresh.jobsIntervalSeconds', 5),
    logPollIntervalSeconds: cfg.get<number>('logs.pollIntervalSeconds', 5),
    maxRunsPerRepo: cfg.get<number>('maxRunsPerRepo', 20),
    maxRunsPerWorkflow: cfg.get<number>('maxRunsPerWorkflow', 5),
    maxJobsPerRun: cfg.get<number>('maxJobsPerRun', 50),
    verboseLogging: cfg.get<boolean>('logging.verbose', false)
  };
}

export function getHostFromBaseUrl(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).host;
  } catch {
    return undefined;
  }
}
