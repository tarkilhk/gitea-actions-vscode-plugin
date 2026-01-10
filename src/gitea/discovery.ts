import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { RepoRef } from './models';
import { getHostFromBaseUrl } from '../config/settings';
import { logDebug, logWarn } from '../util/logging';

const execFileAsync = promisify(execFile);

export async function discoverWorkspaceRepos(baseUrl: string, workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<RepoRef[]> {
  const host = getHostFromBaseUrl(baseUrl);
  if (!host || !workspaceFolders.length) {
    return [];
  }
  const repos: RepoRef[] = [];
  for (const folder of workspaceFolders) {
    try {
      const insideGit = await isInsideGitRepo(folder.uri.fsPath);
      if (!insideGit) {
        continue;
      }
      const remotes = await getGitRemotes(folder.uri.fsPath);
      for (const remote of remotes) {
        const parsed = parseRemote(remote);
        if (!parsed || !hostsMatch(parsed.host, host)) {
          continue;
        }
        const existing = repos.find((r) => r.owner === parsed.owner && r.name === parsed.name);
        if (!existing) {
          repos.push({
            host,
            owner: parsed.owner,
            name: parsed.name,
            htmlUrl: `${baseUrl.replace(/\/+$/, '')}/${parsed.owner}/${parsed.name}`
          });
        }
      }
    } catch (err) {
      logWarn(`Failed to inspect workspace folder ${folder.uri.fsPath}: ${String(err)}`);
    }
  }
  return repos;
}

async function isInsideGitRepo(path: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: path
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function getGitRemotes(path: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', '-v'], { cwd: path });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    logWarn(`Failed to read git remotes in ${path}: ${String(error)}`);
    return [];
  }
}

// Exported for testing
export function parseRemote(remoteLine: string): { host: string; owner: string; name: string } | undefined {
  // Examples:
  // origin  https://host/owner/repo.git (fetch)
  // origin  ssh://git@host:2222/owner/repo.git (push)
  // origin  git@host:owner/repo.git (fetch)
  const parts = remoteLine.split(/\s+/);
  const url = parts[1];
  if (!url) {
    return undefined;
  }

  // HTTPS or SSH with protocol
  const protocolMatch = url.match(/^(https?:\/\/|ssh:\/\/)([^/]+)\/(.+?)(\.git)?$/);
  if (protocolMatch) {
    const hostPart = protocolMatch[2];
    const pathPart = protocolMatch[3];
    const [owner, name] = pathPart.replace(/\.git$/, '').split('/');
    if (owner && name) {
      return { host: hostPart, owner, name };
    }
  }

  // SCP-like git@host:owner/repo.git
  const scpMatch = url.match(/^.+@([^:]+):(.+?)(\.git)?$/);
  if (scpMatch) {
    const hostPart = scpMatch[1];
    const pathPart = scpMatch[2];
    const [owner, name] = pathPart.replace(/\.git$/, '').split('/');
    if (owner && name) {
      return { host: hostPart, owner, name };
    }
  }

  logDebug(`Could not parse remote: ${remoteLine}`);
  return undefined;
}

// Exported for testing
export function hostsMatch(candidate: string, target: string): boolean {
  if (!candidate || !target) {
    return false;
  }
  if (candidate === target) {
    return true;
  }
  const candidateNoPort = candidate.split(':')[0];
  const targetNoPort = target.split(':')[0];
  return candidateNoPort === targetNoPort;
}
