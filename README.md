# Gitea Actions VS Code extension

VS Code / Cursor extension that lists Gitea Actions runs and jobs from your Gitea instance. Click jobs to open logs, refresh runs, and jump to the Gitea UI.

## Features (v1)
- Configure base URL, store PAT in SecretStorage, and test the connection.
- Three discovery modes: workspace git remotes, pinned repositories, or all accessible repos via API.
- Two separate tree views: **Runs (Workspace)** and **Runs (Pinned)**, showing repos → runs → jobs with status icons and timestamps.
- Expand runs to load jobs on-demand; click jobs to view logs in an editor tab.
- Open repo/run/job in browser via context menu.
- Manual refresh plus adaptive polling (faster when runs are active, slower when idle).
- Status bar summary showing running and failed workflow counts.

## Getting started
1) Install dependencies: `npm install`
2) Build: `npm run compile`
3) Launch Extension Development Host (F5) or package a VSIX: `npm run package`

## First run inside the dev host
1) Set `giteaActions.baseUrl` in settings (e.g., `http://localhost:3000` or `https://gitea.example.com`).
2) Run `Gitea Actions: Set Token` (stores PAT in SecretStorage).
3) Run `Gitea Actions: Test Connection`.
4) Open the **Gitea Actions** activity bar to see two views:
   - **Runs (Workspace)**: Shows repos discovered from your workspace
   - **Runs (Pinned)**: Shows repos you've explicitly pinned
5) Use the refresh button if needed.

## Configuration settings
- `giteaActions.baseUrl` (string): Base URL of your Gitea instance
- `giteaActions.tls.insecureSkipVerify` (boolean, default: `false`): Skip TLS certificate verification
- `giteaActions.discovery.mode` (enum: `workspace` | `pinned` | `allAccessible`, default: `workspace`):
  - `workspace`: Discover repos from workspace git remotes
  - `pinned`: Only show pinned repositories
  - `allAccessible`: Fetch all accessible repositories via API
- `giteaActions.refresh.runningIntervalSeconds` (number, default: `15`): Polling interval when runs are active
- `giteaActions.refresh.idleIntervalSeconds` (number, default: `60`): Polling interval when idle
- `giteaActions.maxRunsPerRepo` (number, default: `20`): Maximum runs to fetch per repository
- `giteaActions.maxJobsPerRun` (number, default: `50`): Maximum jobs to fetch per workflow run

## Commands
- `Gitea Actions: Set Token` - Store/update your Personal Access Token
- `Gitea Actions: Clear Token` - Remove stored token
- `Gitea Actions: Test Connection` - Verify connection to Gitea instance
- `Gitea Actions: Refresh` - Manually refresh the tree views
- `Gitea Actions: View Job Logs` - View logs for a selected job (opens in editor)
- `Gitea Actions: Open in Browser` - Open repo/run/job in Gitea web UI
- `Gitea Actions: Pin Repository` - Add repository to pinned list
- `Gitea Actions: Unpin Repository` - Remove repository from pinned list

## Usage tips
- **Jobs are loaded on-demand**: Expand a run node to fetch its jobs (not loaded automatically).
- **Status bar**: Click the status bar item (e.g., "Gitea: 1 running, 0 failed") to focus the Gitea Actions view.
- **Context menus**: Right-click any tree node for relevant actions (refresh, pin/unpin, open in browser, view logs).

## Notes
- The PAT is stored only in VS Code SecretStorage, never in settings or files.
- Run/job endpoints follow the Gitea Actions API; if your server differs, errors are surfaced in the tree view.
- Jobs are fetched with a 4-second timeout per run to prevent hangs.