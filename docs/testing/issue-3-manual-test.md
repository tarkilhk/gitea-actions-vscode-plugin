# Manual Test Plan: Issue #3 (escaped `\\n` in secrets/variables)

This guide validates that pasted values containing escaped newlines are stored correctly.

## Prerequisites
- VS Code/Cursor with this extension installed from your local build.
- `giteaActions.baseUrl` configured.
- A valid token set with access to manage repository Actions secrets/variables.
- A test repository where you can create and edit Actions secrets and variables.

## Test data
Use this sample SSH key-shaped payload (escaped newlines):

```text
-----BEGIN OPENSSH PRIVATE KEY-----\\nline-1\\nline-2\\n-----END OPENSSH PRIVATE KEY-----
```

## Test 1: Create Secret with escaped newlines
1. Open **Gitea Actions → Settings → Secrets** for the test repo.
2. Choose **Add Secret**.
3. Enter name: `SSH_KEY_TEST`.
4. Paste the test payload into **Secret value**.
5. Save.
6. In Gitea web UI, open the secret (or consume it in a workflow) and verify content behaves as multiline text, not literal `\\n` characters.

### Expected
- Secret is created successfully.
- Stored value is interpreted with real line breaks.

## Test 2: Update existing Secret
1. Edit `SSH_KEY_TEST`.
2. Replace with a different escaped-newline payload.
3. Save.
4. Verify value is still multiline when used/read.

### Expected
- Secret update succeeds.
- New content preserves intended line breaks.

## Test 3: Create Variable with escaped newlines
1. Open **Gitea Actions → Settings → Variables**.
2. Choose **Add Variable**.
3. Enter name: `SSH_KEY_VAR_TEST`.
4. Paste the same escaped-newline payload as value.
5. Save.
6. Verify in Gitea UI/API that value reflects multiline content.

### Expected
- Variable is created successfully.
- Stored value contains real newlines.

## Test 4: Update existing Variable
1. Edit `SSH_KEY_VAR_TEST`.
2. Change the value using escaped newlines.
3. Save and re-check.

### Expected
- Variable update succeeds.
- Updated value preserves expected line breaks.

## Regression checks
- Create/update a normal single-line secret/variable.
- Create/update values containing intentional backslashes not followed by `n`/`r`.

### Expected
- Single-line values remain unchanged.
- Non-newline escape-like content remains unaffected.
