import * as vscode from 'vscode';

const SECRET_KEY = 'giteaActions.pat';

export async function storeToken(secretStorage: vscode.SecretStorage, token: string): Promise<void> {
  await secretStorage.store(SECRET_KEY, token);
}

export async function clearToken(secretStorage: vscode.SecretStorage): Promise<void> {
  await secretStorage.delete(SECRET_KEY);
}

export async function getToken(secretStorage: vscode.SecretStorage): Promise<string | undefined> {
  return secretStorage.get(SECRET_KEY);
}

export async function promptForToken(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Enter your Gitea Personal Access Token',
    placeHolder: 'token',
    ignoreFocusOut: true,
    password: true,
    validateInput: (value) => (!value.trim() ? 'Token cannot be empty' : undefined)
  });
}
