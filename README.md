# Gitea Actions VS Code Extension

View and manage Gitea Actions workflow runs directly from VS Code / Cursor.

## Features

- **Workflow Monitoring** — View workflow runs, jobs, and steps with live status icons
- **Live Log Streaming** — View logs in editor tabs with auto-refresh for running jobs
- **Secrets & Variables** — Create, update, and delete repository secrets and variables
- **Multiple Discovery Modes** — Discover repos from workspace, pinned list, or all accessible via API
- **Adaptive Polling** — Faster refresh when runs are active, slower when idle
- **Status Bar** — Quick summary of running and failed workflow counts

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=tarkil.gitea-actions-vscode-plugin) or [Open VSX Registry](https://open-vsx.org/extension/tarkil/gitea-actions-vscode-plugin).

## Setup

1. Open VS Code Settings and set `giteaActions.baseUrl` to your Gitea instance URL  
   (e.g., `https://gitea.example.com` or `http://localhost:3000`)

2. Run the command **Gitea Actions: Set Token** and enter your Personal Access Token

3. Run **Gitea Actions: Test Connection** to verify everything works

4. Open the **Gitea Actions** panel in the activity bar

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `giteaActions.baseUrl` | — | Base URL of your Gitea instance |
| `giteaActions.tls.insecureSkipVerify` | `false` | Skip TLS certificate verification |
| `giteaActions.discovery.mode` | `workspace` | How to discover repos: `workspace`, `pinned`, or `allAccessible` |
| `giteaActions.refresh.runningIntervalSeconds` | `15` | Polling interval when runs are active |
| `giteaActions.refresh.idleIntervalSeconds` | `60` | Polling interval when idle |
| `giteaActions.maxRunsPerRepo` | `20` | Maximum runs to fetch per repository |
| `giteaActions.maxJobsPerRun` | `50` | Maximum jobs to fetch per workflow run |

### Discovery Modes

- **workspace** — Discovers repositories from git remotes in your open workspace folders
- **pinned** — Shows only repositories you've explicitly pinned
- **allAccessible** — Fetches all repositories you have access to via the Gitea API

## Commands

| Command | Description |
|---------|-------------|
| **Set Token** | Store your Gitea Personal Access Token |
| **Clear Token** | Remove stored token |
| **Test Connection** | Verify connection to your Gitea instance |
| **Refresh** | Manually refresh all tree views |
| **View Job Logs** | Open logs for a job or step |
| **Open in Browser** | Open the item in Gitea's web UI |
| **Pin/Unpin Repository** | Add or remove a repo from your pinned list |

## Tree Views

### Current Branch Runs
Shows repositories discovered from your workspace with their recent workflow runs.

### Workflows  
Shows pinned repositories (or all repos depending on discovery mode).

### Settings
Displays token status and lets you manage repository secrets and variables:
- **Secrets** — Encrypted values (e.g., API keys, passwords)
- **Variables** — Plain text configuration values

Right-click on Secrets or Variables to add, edit, or delete items.

## Tips

- **Expand runs** to load jobs on-demand (they're not fetched until you expand)
- **Click a job or step** to view its logs in an editor tab
- **Running jobs** stream logs live and auto-update until completion
- **Click the status bar** to quickly focus the Gitea Actions view
- **Right-click** any tree item for context menu actions

## Security

Your Personal Access Token is stored securely in VS Code's SecretStorage and is never written to settings files or logs.

## License

MIT — See [LICENSE](LICENSE) for details.
