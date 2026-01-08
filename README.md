# Gitea Actions VS Code extension

VS Code / Cursor extension that lists Gitea Actions runs and jobs from your Gitea instance. Click jobs to open logs, refresh runs, and jump to the Gitea UI.

## Features (v1)
- Configure base URL, store PAT in SecretStorage, and test the connection.
- Discover repos from workspace git remotes or pinned list; optional all-accessible mode via API.
- Tree view showing repos → runs → jobs with status icons and timestamps.
- Open run/job in browser; view job logs in an editor tab.
- Manual refresh plus adaptive polling; status bar summary.

## Getting started
1) Install dependencies: `npm install`
2) Build: `npm run compile`
3) Launch Extension Development Host (F5) or package a VSIX: `npm run package`

## First run inside the dev host
1) Set `giteaActions.baseUrl` in settings.
2) Run `Gitea Actions: Set Token` (stores PAT in SecretStorage).
3) Run `Gitea Actions: Test Connection`.
4) Open the **Gitea Actions** view to see repos/runs/jobs. Use the refresh button if needed.

## Commands
- `Gitea Actions: Set Token`
- `Gitea Actions: Clear Token`
- `Gitea Actions: Test Connection`mp
- `Gitea Actions: Refresh`
- `Gitea Actions: View Job Logs`
- `Gitea Actions: Open in Browser`
- `Gitea Actions: Pin Repository` / `Unpin Repository`

## Notes
- The PAT is stored only in VS Code SecretStorage, never in settings or files.
- Run/job endpoints follow the Gitea Actions API; if your server differs, errors are surfaced in the tree view.
