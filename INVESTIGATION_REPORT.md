# Investigation: Steps Unavailable for Some Repos (homelab-infra vs airbyte-coinbase-source)

**Date:** 2026-02-10  
**Gitea:** https://gitea.hollinger.asia (version 1.25.4)

## Summary

Steps **work** for **airbyte-coinbase-source** (public repo) and **fail** for **homelab-infra** (private repo) because **Gitea returns 404 for the internal (web UI) actions run page when the repo is private and the request uses a PAT**. For public repos, the same PAT can access the run page and the internal API, so steps load.

This is **not** due to repo age or run ID format. It is due to **repository visibility (private vs public)** and how Gitea secures the web UI routes for actions.

---

## How the extension gets steps

1. **Official API**  
   `GET /api/v1/repos/{owner}/{repo}/actions/jobs/{job_id}`  
   - Has a `steps` field in the schema but **Gitea does not populate it** (always `null`).  
   - Checked for both repos: **steps are null** for both.

2. **Internal (web UI) API**  
   Used as fallback:
   - **GET** `/{owner}/{repo}/actions/runs/{runId}` → get CSRF/cookies from the run page.
   - **POST** `/{owner}/{repo}/actions/runs/{runId}/jobs/{jobIndex}` with `{"logCursors":[]}` → returns job + steps.

   The extension tries **database run id** first, then **run_number** on 404 (because the web UI URL uses `run_number`, e.g. `.../actions/runs/24`).

---

## What was tested with your PAT

| Request | homelab-infra (private) | airbyte-coinbase-source (public) |
|--------|--------------------------|-----------------------------------|
| GET `.../actions/runs/964` (db id) | **404** | **404** |
| GET `.../actions/runs/813` (run_number) | **404** | — |
| GET `.../actions/runs/965` (db id) | — | **404** |
| GET `.../actions/runs/24` (run_number) | — | **200** |
| Official API `GET .../actions/jobs/{id}` → `steps` | **null** | **null** |

- **homelab-infra:** run id 964, run_number 813, repo **private**.  
  Both `.../runs/964` and `.../runs/813` return **404** with PAT.  
  So the extension never gets a valid run page, no CSRF, and the internal API cannot be used → “Steps unavailable: Gitea requires browser session”.

- **airbyte-coinbase-source:** run id 965, run_number 24, repo **public**.  
  `.../runs/965` → 404, but `.../runs/24` → **200** with PAT.  
  So on retry with run_number 24, the extension gets the run page, CSRF, and can POST to the internal jobs endpoint → steps load.

So the difference is **not** “old vs new repo” or “run id vs run_number” in general; it is that **the internal run page is only accessible with PAT for public repos**. For private repos, Gitea responds 404 to that same request (as if the run or page does not exist when using PAT).

---

## Root cause

- **Gitea’s behavior:** The internal (web) route for a run,  
  `GET /{owner}/{repo}/actions/runs/{run_number}`,  
  is **accessible with a PAT for public repos** (200) and **returns 404 for private repos** when using PAT. So for private repos, the UI run page (and thus the internal API that depends on it) is effectively gated to browser session (or other auth that Gitea allows for that route).
- **Extension behavior:** Steps are only available when the internal API can be used. That requires a successful GET to the run page to obtain CSRF/cookies. So:
  - **Public repo** → GET with run_number can succeed → steps work.
  - **Private repo** → GET returns 404 → no CSRF → internal API cannot be used → “Steps unavailable: Gitea requires browser session (not supported with PAT)”.

---

## Possible directions (for discussion)

1. **No code change (current behavior)**  
   - Document clearly that steps are only available for **public** repos when using a PAT; for private repos, steps remain “unavailable” and users can use the Gitea web UI in a browser for step details.

2. **Try run_number first for the internal API**  
   - Use `run_number` in the internal API URL when it exists and differs from `id`, so public repos succeed on the first attempt (one fewer 404). This does **not** fix private repos; it only optimizes public ones.

3. **Ask Gitea to allow PAT for internal actions endpoints on private repos**  
   - Feature request / issue: allow PAT-authenticated access to  
     `/{owner}/{repo}/actions/runs/{run_number}` and the related POST for jobs (or an equivalent official API that returns steps) for private repos the user has access to.

4. **Official API steps**  
   - If a future Gitea version populates `steps` in  
     `GET /api/v1/repos/{owner}/{repo}/actions/jobs/{job_id}`,  
   the extension would get steps for all repos (public and private) without using the internal API.

**Update (post-investigation):** The extension now uses only `run_number` for the internal API (db id fallback removed) and tries to get CSRF from the **repo root** (`/{owner}/{repo}`) when the actions run page returns 404 (e.g. private repos). We tested: for private repos the repo root returns 404 but that response still sets Set-Cookie (_csrf, i_like_gitea). Using that session + CSRF on the internal POST .../actions/runs/{run_number}/jobs/0 still returns 404 — the actions endpoint itself is gated; the workaround does not help.

---

## What others say (online search)

- **Step-level API is a known gap** — [Issue #35176](https://github.com/go-gitea/gitea/issues/35176) "API endpoint to download logs per step of a workflow" (open, proposal). Asks for an API that accepts POST with logCursors and expanded per step, like the UI. Current API only has actions/jobs/{job_id}/logs (all steps). No workaround; feature request.
- **Upstream work in progress** — [PR #35382](https://github.com/go-gitea/gitea/pull/35382) "Add Actions API endpoints for workflow run and job management" (open). Addresses #35176; adds streaming log API with cursor (POST /actions/runs/{run}/logs). When merged, official token-based step/streamed logs may be possible.
- **Official API permissions** — [Issue #36268](https://github.com/go-gitea/gitea/issues/36268): actions runs/jobs endpoints require owner; reporter wants read to match GitHub. Separate from internal UI/private-repo 404.
- **No public discussion** of "private repo actions run page 404 with PAT" or a client-side workaround. The path that could fix this is Gitea merging PR #35382 (or similar) so step/cursor logs are in the **official** API and the extension can use token auth.

If you want, we can next: (a) add a short note in the README/code about private vs public and steps, and/or (b) implement “try run_number first” for the internal API so public repos don’t hit the 404 with the db id first.
