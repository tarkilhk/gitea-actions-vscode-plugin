# Gitea Actions

> Monitor your CI/CD pipelines without leaving your editor

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/tarkil.gitea-actions-vscode-plugin?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=tarkil.gitea-actions-vscode-plugin)
[![Open VSX](https://img.shields.io/open-vsx/v/tarkil/gitea-actions-vscode-plugin?label=Open%20VSX)](https://open-vsx.org/extension/tarkil/gitea-actions-vscode-plugin)
[![License](https://img.shields.io/github/license/tarkilhk/gitea-actions-vscode-plugin)](LICENSE)

A powerful extension that brings Gitea Actions directly into your editor. View workflow runs, stream logs in real-time, and manage secrets — all without switching to your browser.

**Works with:** VS Code, Cursor, VSCodium, Windsurf, and any editor supporting VS Code extensions.

## Why Use This Extension?

- **Stay in flow** — No more context-switching to check if your build passed
- **Real-time feedback** — Watch logs stream live as your jobs run
- **Full control** — Manage secrets and variables right from your editor
- **Universal compatibility** — Works with VS Code, Cursor, VSCodium, and more

## Features

### Live Workflow Monitoring
See all your workflow runs at a glance with live status updates. Runs are organized by repository with clear visual indicators for success, failure, running, and queued states.

### Real-Time Log Streaming
Click any running job to stream its logs directly in an editor tab. Logs auto-refresh until the job completes — no manual refreshing needed.

### Step-by-Step Debugging
Drill down into individual steps to view their specific logs. Perfect for pinpointing exactly where a workflow failed.

### Secrets & Variables Management  
Create, update, and delete repository secrets and variables without leaving VS Code. Manage your CI/CD configuration in one place.

### Smart Polling
The extension adapts its refresh rate based on activity:
- **15 seconds** when workflows are running (configurable)
- **15 seconds** when idle (configurable)

**Targeted Refresh:** Run status is always refreshed, but job and step details are only fetched for expanded runs (or runs that already have jobs loaded). Active expanded runs refresh job/step data every 5 seconds until completion.

**Log Streaming:** Job and step logs poll every 5 seconds while streaming.

### Status Bar Integration
A subtle status bar indicator shows you the current state of your workflows at a glance.

## Quick Start

### 1. Install

**VS Code / Cursor / Windsurf:**  
Search for "Gitea Actions" in the Extensions panel, or get it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=tarkil.gitea-actions-vscode-plugin).

**VSCodium / Gitpod / Theia:**  
Install from the [Open VSX Registry](https://open-vsx.org/extension/tarkil/gitea-actions-vscode-plugin).

### 2. Configure
1. Open **Settings** and set `giteaActions.baseUrl` to your Gitea instance  
   (e.g., `https://gitea.example.com`)

2. Open the **Gitea Actions** panel in the activity bar

3. In the **Settings** section, click the pencil icon next to **Token** to set your Personal Access Token

4. Click **Test Connection** to verify everything works

That's it! Your repositories will appear automatically.

## Tree Views

### Workflow Runs
Shows your repositories with their recent workflow runs. The tree is organized as:

```
Repository
  └── Workflow Run #123
        └── Job: build
              └── Step: Checkout
              └── Step: Build
              └── Step: Test
```

When you have a single repository open, it auto-expands for quick access.

### Workflows
Groups runs by workflow name — useful when you want to see all runs of a specific workflow across your repositories.

### Settings
Manage your extension configuration:
- **Token** — Set or clear your Personal Access Token
- **Test Connection** — Verify your Gitea connection
- **Secrets** — Manage encrypted repository secrets
- **Variables** — Manage plain-text configuration variables

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `giteaActions.baseUrl` | — | Base URL of your Gitea instance |
| `giteaActions.discovery.mode` | `workspace` | How to discover repos (see below) |
| `giteaActions.refresh.runningIntervalSeconds` | `15` | Polling interval when runs are active |
| `giteaActions.refresh.idleIntervalSeconds` | `15` | Polling interval when idle |
| `giteaActions.maxRunsPerRepo` | `20` | Maximum runs to fetch per repository |
| `giteaActions.maxJobsPerRun` | `50` | Maximum jobs to fetch per run |
| `giteaActions.tls.insecureSkipVerify` | `false` | Skip TLS verification (not recommended) |

### Discovery Modes

| Mode | Description |
|------|-------------|
| `workspace` | Discovers repositories from git remotes in your open workspace folders. Best for most users. |
| `allAccessible` | Fetches all repositories you have access to via the Gitea API. Useful if you want to monitor repos you haven't cloned. |

## Tips & Tricks

- **Expand runs on-demand** — Jobs aren't fetched until you expand a run, keeping things fast
- **Click any job** to view its complete logs in an editor tab
- **Click a specific step** to view only that step's logs
- **Right-click items** for context menu actions like "Open in Browser"
- **Click the status bar** to quickly jump to the Gitea Actions panel

## Security

Your Personal Access Token is stored securely using the editor's built-in SecretStorage API. It's never written to settings files, logs, or transmitted anywhere except to your Gitea instance.

## Requirements

- Any compatible editor: VS Code 1.105+, Cursor, VSCodium, Windsurf, Gitpod, or Theia
- A Gitea instance with Actions enabled
- A Personal Access Token with appropriate permissions

## Contributing

Contributions are welcome! Check out the [GitHub repository](https://github.com/tarkilhk/gitea-actions-vscode-plugin) to report issues or submit pull requests.

## License

MIT — See [LICENSE](LICENSE) for details.

---

**Enjoying this extension?** Consider leaving a ⭐ on [GitHub](https://github.com/tarkilhk/gitea-actions-vscode-plugin), or a review on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=tarkil.gitea-actions-vscode-plugin) or [Open VSX Registry](https://open-vsx.org/extension/tarkil/gitea-actions-vscode-plugin)!
