# Gitea Actions for VS Code / Cursor — Implementation Plan (Hand-off Doc)

**Goal:** Build a VS Code extension (installable as a `.vsix`) that works in **Cursor** and provides a **GitHub Actions–like experience** for **Gitea Actions** on a **local Gitea instance**: list workflow runs, show statuses, drill into jobs, and view job logs.

This document is written so a coding assistant can start immediately.

---

## 0) Scope and deliverables

### v1 (must-have)
1. **Authentication**
   - Configure `baseUrl` for Gitea.
   - Store **Personal Access Token (PAT)** in VS Code **SecretStorage** (never in settings).
   - A command to set/update token and test connectivity.

2. **Repo discovery**
   - Default mode: discover repos from the **open workspace** (git remotes).
   - Optional mode: **Pinned repos** list stored in extension global state.

3. **Tree view (Activity Bar)**
   - A dedicated view container **“Gitea Actions”**.
   - Tree structure: `Repo → Runs → Jobs`.
   - Show statuses with icons, timestamps, basic metadata.

4. **Run refresh**
   - Manual refresh command + UI button.
   - Polling strategy: fast refresh if anything running; slow refresh if idle.

5. **Logs**
   - Click a job → fetch logs via API and open in editor as a text document.

6. **Open in browser**
   - Context menu items for run/job that open the Gitea UI page.

### v2 (optional)
- Artifacts listing/download (if supported by your Gitea version).
- Re-run / cancel run (if supported).
- Notifications on failure.
- WebView log viewer with search/collapse.

---

## 1) Assumptions and non-goals

### Assumptions
- You have a working local Gitea instance with Actions enabled.
- Your user can create a PAT with appropriate scopes (likely `repo` or equivalent).
- Cursor can install local `.vsix` extensions (common for VS Code forks).

### Non-goals (v1)
- No step-level log cursor streaming; job-level logs only.
- No per-step status view unless your Gitea API exposes it cleanly.
- No mutation endpoints (rerun/cancel) unless explicitly added in v2.

---

## 2) UX specification

### 2.1 View container and views
- Activity Bar: **Gitea Actions**
- View: **Runs (Workspace)** (default)
- View (optional): **Runs (Pinned)**

### 2.2 Tree shape (v1)
- **Repo node**: `owner/repo`
  - **Run node**: `workflowName (if available) · branch · shortSHA`  
    - **Job node**: `jobName · status · duration`

### 2.3 Interactions
- Clicking a **job** opens logs in an editor tab.
- Context menu actions:
  - Repo: Refresh, Pin/Unpin
  - Run: Open in Browser, Refresh
  - Job: View Logs, Open in Browser

### 2.4 Status indicators
Use consistent labels (normalized):
- `queued`, `running`, `success`, `failure`, `cancelled`, `skipped`, `unknown`

Use codicons where possible:
- running: `sync~spin`
- success: `check`
- failure: `error`
- cancelled: `circle-slash`
- queued: `clock`
- unknown: `question`

### 2.5 Status bar item (nice-to-have in v1)
- Example: `Gitea: 1 running, 0 failed`  
Click → focuses the Gitea Actions view.

---

## 3) Configuration, secrets, and first-run flow

### 3.1 Settings (settings.json)
Proposed settings keys:
- `giteaActions.baseUrl` (string) — e.g. `http://tarkilnas:3000` or `https://gitea.hollinger.asia`
- `giteaActions.tls.insecureSkipVerify` (boolean, default `false`)
- `giteaActions.discovery.mode` (enum: `workspace | pinned | allAccessible`, default `workspace`)
- `giteaActions.refresh.runningIntervalSeconds` (number, default `15`)
- `giteaActions.refresh.idleIntervalSeconds` (number, default `60`)
- `giteaActions.maxRunsPerRepo` (number, default `20`)

### 3.2 Secret storage
- Store PAT under key: `giteaActions.pat` in **SecretStorage**.
- Commands:
  - `Gitea Actions: Set Token`
  - `Gitea Actions: Clear Token`
  - `Gitea Actions: Test Connection`

### 3.3 First-run behavior
If `baseUrl` unset or PAT missing:
- Prompt user with actionable steps:
  1. Set `giteaActions.baseUrl`
  2. Run “Set Token”
  3. Run “Test Connection”

---

## 4) API discovery strategy (critical)

**Do not hardcode endpoints until confirming what your Gitea instance supports.** Gitea Actions APIs differ by version and permissions.

### 4.1 Prefer Swagger/OpenAPI from the running server
Attempt to fetch OpenAPI JSON from these likely paths (in order):
1. `${baseUrl}/swagger.v1.json`
2. `${baseUrl}/api/swagger.v1.json`
3. `${baseUrl}/api/swagger.json`
4. `${baseUrl}/api/swagger`

If found:
- Parse and record the canonical endpoints for:
  - List runs for repo
  - List jobs for run
  - Job logs
  - (Optional) artifacts, rerun/cancel

If not found:
- Fall back to “known likely” endpoints and test with a probe, but surface clear errors if unsupported.

### 4.2 Minimum endpoints needed for v1
The client must support:
- **List runs** for repo
- **List jobs** for a run
- **Fetch job logs**
- **(Optional)** list repos (only needed for `allAccessible` discovery mode)

Expected path patterns (confirm with Swagger):
- `GET /api/v1/repos/{owner}/{repo}/actions/runs`
- `GET /api/v1/repos/{owner}/{repo}/actions/runs/{run_id}/jobs`
- `GET /api/v1/actions/jobs/{job_id}/logs` (or similar)

### 4.3 Authentication header
Use PAT in header:
- `Authorization: token <PAT>`

(Confirm your Gitea expects this exact scheme; some deployments also accept `Bearer` but default to token scheme.)

### 4.4 Permissions handling
If runs endpoint returns **403** or **404**:
- Show a warning in the view: “Insufficient permission or endpoint not available in this Gitea version.”
- Provide remediation hints:
  - token scopes
  - ensure Actions enabled for repo
  - verify API endpoints via Swagger
- Do not crash the extension.

---

## 5) Repo discovery details

### 5.1 Discovery mode: workspace (default)
For each workspace folder:
1. Determine if it’s a git repo:
   - Prefer using the built-in `vscode.git` extension API if available,
   - or call `git rev-parse --is-inside-work-tree`.
2. Get remotes:
   - `git remote -v`
3. Parse remote URL forms:
   - HTTPS: `https://host/owner/repo.git`
   - SSH: `ssh://git@host:2222/owner/repo.git`
   - SCP-like: `git@host:owner/repo.git`
4. Filter by host matching `giteaActions.baseUrl` host (initially single-host support).
5. Extract `{owner, repo}`.

### 5.2 Discovery mode: pinned
- Store pinned repos in `context.globalState`:
  - `giteaActions.pinnedRepos = Array<{ owner: string; repo: string }>`
- Command: Pin/Unpin on repo node.

### 5.3 Discovery mode: allAccessible (optional)
- Use Gitea API to list accessible repos (pagination).
- Cache results and avoid doing it on activation if performance is poor.

---

## 6) Data model (normalize early)

Define normalized internal types independent of raw API payloads:

```ts
export type RepoRef = {
  host: string;       // derived from baseUrl
  owner: string;
  name: string;
  htmlUrl?: string;
};

export type WorkflowRun = {
  id: number | string;
  name: string;       // workflow name if available, else fallback
  branch?: string;
  sha?: string;
  status: 'queued' | 'running' | 'completed' | 'unknown';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';
  createdAt?: string;
  updatedAt?: string;
  htmlUrl?: string;
};

export type Job = {
  id: number | string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'unknown';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';
  startedAt?: string;
  completedAt?: string;
  htmlUrl?: string;
};
```

Map raw API → these types in one place (adapter layer) so UI remains stable across API changes.

---

## 7) Extension architecture (recommended project layout)

### 7.1 Tech choices
- Language: TypeScript
- HTTP: `undici` (preferred) or `node-fetch`
- Tooling: `@vscode/vsce` for packaging

### 7.2 Layout
```
src/
  extension.ts
  config/
    settings.ts
    secrets.ts
  gitea/
    client.ts
    api.ts
    models.ts
    discovery.ts
  views/
    actionsTreeProvider.ts
    nodes.ts
    icons.ts
  controllers/
    refreshController.ts
    commands.ts
  util/
    cache.ts
    time.ts
    logging.ts
```

### 7.3 Responsibilities
- `extension.ts`: activation, register tree provider, register commands, wiring, status bar
- `gitea/client.ts`: base HTTP, auth header injection, TLS options, timeouts, retries
- `gitea/api.ts`: high-level API calls (listRuns/listJobs/getJobLogs)
- `gitea/discovery.ts`: repo discovery for each mode
- `views/actionsTreeProvider.ts`: TreeDataProvider that renders Repo/Run/Job nodes
- `controllers/refreshController.ts`: polling scheduling + cache invalidation
- `controllers/commands.ts`: command implementations (refresh, open, logs, pin)

---

## 8) Tree view implementation detail

### 8.1 Node types
- `RepoNode` → children are `RunNode[]`
- `RunNode` → children are `JobNode[]`
- `JobNode` → leaf

Each node should include:
- id (stable key), label, description, tooltip, icon, contextValue, command

### 8.2 Commands wiring
- JobNode command: `giteaActions.viewJobLogs` with args `{ jobId, repoRef }`
- Open browser: use `vscode.env.openExternal(vscode.Uri.parse(url))`

### 8.3 Context values (for menus)
- `contextValue = 'giteaRepo' | 'giteaRun' | 'giteaJob'`

---

## 9) Refresh and polling strategy

### 9.1 Cache
In-memory per repo:
- last runs list
- last jobs map by run id
- last refresh time
- last error (if any)

### 9.2 Polling logic
- Determine whether anything is running:
  - If any run status is `queued` or `running` → use running interval (default 15s)
  - else idle interval (default 60s)
- Avoid overlapping refreshes:
  - ensure only one refresh per repo at a time
- Concurrency limit:
  - max 4 concurrent HTTP calls globally

### 9.3 Refresh sequence per repo
1. `listRuns(owner, repo, limit=maxRunsPerRepo)`
2. For top N most recent runs (and for any running runs):
   - `listJobs(runId)`
3. Never fetch logs automatically.

---

## 10) Logs handling

### 10.1 v1 logs display
- On demand:
  - Fetch text log payload
  - `vscode.workspace.openTextDocument({ content, language: 'log' })`
  - `vscode.window.showTextDocument(doc, { preview: true })`

### 10.2 Safety
- Logs may include secrets if CI is misconfigured.
- Do not persist logs to disk by default.
- Avoid writing logs to extension output unless user enables debug.

---

## 11) Error handling and user messaging

### 11.1 Common cases
- Base URL unreachable → show in view and notification (once per session)
- Invalid PAT → show “Unauthorized; set token”
- 403 on actions endpoints → show “Insufficient permission”
- 404 on actions endpoints → show “Endpoint not supported in this Gitea version”

### 11.2 Where to display errors
- Tree view should show a single “Error node” under repo with readable text
- Use `vscode.window.showWarningMessage` sparingly (avoid spam)

---

## 12) `package.json` contributions checklist

### 12.1 View container + view
- `viewsContainers.activitybar`: add container `giteaActions`
- `views`: register `giteaActions.runs`

### 12.2 Commands
- `giteaActions.setToken`
- `giteaActions.clearToken`
- `giteaActions.testConnection`
- `giteaActions.refresh`
- `giteaActions.viewJobLogs`
- `giteaActions.openInBrowser`
- `giteaActions.pinRepo`
- `giteaActions.unpinRepo`

### 12.3 Menus
- `view/title`: Refresh button
- `view/item/context`: Open, Logs, Pin/Unpin

---

## 13) Milestones with acceptance criteria

### Milestone 0 — Scaffold
- Generate extension (TypeScript) with activation event.
- **Pass:** extension loads; commands appear in Command Palette.

### Milestone 1 — Config + token + connection test
- Settings read + SecretStorage PAT.
- Test endpoint (either `/api/v1/version` or a “current user” endpoint from Swagger).
- **Pass:** user can set token and “Test Connection” returns OK.

### Milestone 2 — Workspace repo discovery
- Parse git remotes and derive owner/repo.
- **Pass:** repos appear in tree for current workspace.

### Milestone 3 — Runs list
- Fetch runs, show status icons, show timestamps.
- **Pass:** tree shows latest N runs per repo and updates on refresh.

### Milestone 4 — Jobs + logs
- Expand run to view jobs.
- Job click opens logs.
- **Pass:** logs open reliably; job statuses match Gitea UI.

### Milestone 5 — Polish
- Status bar summary.
- Open in browser actions.
- Robust error nodes.
- **Pass:** daily-driver usability, no crashes with failures.

### Milestone 6 — Optional features
- Artifacts / rerun / cancel if available.
- **Pass:** feature flags and graceful fallback if unsupported.

---

## 14) Local development + packaging runbook (for the assistant)

### 14.1 Dev prerequisites
- Node.js (LTS)
- VS Code installed (Cursor also fine, but test in VS Code first)
- `npm install -g @vscode/vsce`

### 14.2 Dev loop
- `npm install`
- `npm run compile` (or `npm run watch`)
- Press `F5` to launch Extension Development Host.
- In the dev host:
  - set `giteaActions.baseUrl`
  - run `Gitea Actions: Set Token`
  - run `Gitea Actions: Test Connection`

### 14.3 Package `.vsix`
- `vsce package`
- Install in Cursor:
  - “Install from VSIX…” and select generated file

---

## 15) Implementation notes for robustness

1. **Swagger-driven endpoint mapping is the safest approach.** If swagger is present, use it to locate exact routes.
2. Normalize statuses and keep UI stable even if upstream payload changes.
3. Avoid any network calls on activation that could hang; defer to when view is revealed.
4. Add a debug output channel that is off by default.
5. Keep the v1 scope tight: runs/jobs/logs + refresh.

---

## 16) Questions the assistant should resolve by inspecting your Gitea instance

These are not for you to answer now; the assistant should confirm by probing Swagger and endpoints:

- Which exact endpoints exist for:
  - list runs
  - list jobs
  - job logs
  - repo listing (if needed)
- What fields are present for:
  - run name/workflow name
  - branch/sha
  - run html URL
  - job html URL
- Any pagination requirements (page/per_page)
- Any special authentication scheme required by your deployment

---

## 17) Definition of “Done” (v1)

A user can:
1. Open Cursor with a workspace containing Gitea repos.
2. Configure base URL, set token.
3. See repos listed in **Gitea Actions** view.
4. See last 20 runs per repo with status icons.
5. Expand a run to see jobs.
6. Click a job to open logs in a text editor.
7. Refresh manually; polling updates running jobs.
8. No crashes on network/permission errors; errors are shown in the view.

---

**End of hand-off document.**
