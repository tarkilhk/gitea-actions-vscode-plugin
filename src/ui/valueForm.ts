import * as vscode from 'vscode';

type ValueFormOptions = {
  title: string;
  submitLabel: string;
  includeName: boolean;
  nameLabel: string;
  namePlaceholder: string;
  nameValue?: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  descriptionValue?: string;
  valueLabel: string;
  valuePlaceholder: string;
  valueValue?: string;
  isSecret: boolean;
  helperText?: string;
  validateName?: (value: string) => string | undefined;
};

export type ValueFormResult = {
  name?: string;
  value: string;
  description?: string;
};

type SubmitMessage = {
  type: 'submit';
  payload: {
    name?: string;
    value: string;
    description?: string;
  };
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createFormHtml(options: ValueFormOptions): string {
  const escapedTitle = escapeHtml(options.title);
  const escapedSubmit = escapeHtml(options.submitLabel);
  const escapedNameLabel = escapeHtml(options.nameLabel);
  const escapedNamePlaceholder = escapeHtml(options.namePlaceholder);
  const escapedNameValue = escapeHtml(options.nameValue ?? '');
  const escapedDescriptionLabel = escapeHtml(options.descriptionLabel);
  const escapedDescriptionPlaceholder = escapeHtml(options.descriptionPlaceholder);
  const escapedDescriptionValue = escapeHtml(options.descriptionValue ?? '');
  const escapedValueLabel = escapeHtml(options.valueLabel);
  const escapedValuePlaceholder = escapeHtml(options.valuePlaceholder);
  const escapedValueValue = escapeHtml(options.valueValue ?? '');
  const escapedHelperText = escapeHtml(
    options.helperText ??
      'Paste multiline content directly, or use escaped \\n sequences; both are saved as real newlines.'
  );

  const nameField = options.includeName
    ? `<div class="field">
         <label for="name">${escapedNameLabel}</label>
         <input id="name" placeholder="${escapedNamePlaceholder}" value="${escapedNameValue}" />
         <div id="nameError" class="error"></div>
       </div>`
    : '';

  const secretWarning = options.isSecret
    ? '<div class="warning">Gitea secrets cannot be viewed after saving.</div>'
    : '';

  const hideSecretToggle = options.isSecret
    ? '<label class="toggle"><input id="hideSecret" type="checkbox" checked /> Conceal value in editor</label>'
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); }
    h2 { margin-top: 0; font-size: 1.1rem; }
    .field { margin-bottom: 12px; }
    label { display: block; font-weight: 600; margin-bottom: 4px; }
    input, textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 8px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    textarea { min-height: 170px; resize: vertical; }
    .hint { opacity: 0.9; margin: 8px 0 12px; }
    .warning {
      padding: 8px;
      border-radius: 4px;
      margin-bottom: 12px;
      background: var(--vscode-inputValidation-warningBackground, rgba(128, 96, 0, 0.2));
      border: 1px solid var(--vscode-inputValidation-warningBorder, transparent);
    }
    .error { color: var(--vscode-errorForeground); min-height: 1.2em; margin-top: 4px; }
    .actions { display: flex; gap: 8px; margin-top: 12px; }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .toggle { display: inline-flex; gap: 8px; align-items: center; margin: 4px 0 10px; font-weight: 400; }
    textarea.concealed {
      color: transparent;
      text-shadow: 0 0 6px var(--vscode-foreground);
      caret-color: var(--vscode-foreground);
    }
  </style>
</head>
<body>
  <h2>${escapedTitle}</h2>
  ${secretWarning}
  <p class="hint">${escapedHelperText}</p>
  <form id="form">
    ${nameField}
    <div class="field">
      <label for="value">${escapedValueLabel}</label>
      ${hideSecretToggle}
      <textarea id="value" placeholder="${escapedValuePlaceholder}">${escapedValueValue}</textarea>
      <div id="valueError" class="error"></div>
    </div>
    <div class="field">
      <label for="description">${escapedDescriptionLabel}</label>
      <input id="description" placeholder="${escapedDescriptionPlaceholder}" value="${escapedDescriptionValue}" />
    </div>
    <div class="actions">
      <button type="submit">${escapedSubmit}</button>
      <button id="cancelButton" type="button" class="secondary">Cancel</button>
    </div>
  </form>
  <script>
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('form');
    const nameInput = document.getElementById('name');
    const valueInput = document.getElementById('value');
    const descriptionInput = document.getElementById('description');
    const valueError = document.getElementById('valueError');
    const nameError = document.getElementById('nameError');
    const cancelButton = document.getElementById('cancelButton');
    const hideSecret = document.getElementById('hideSecret');

    if (hideSecret && valueInput) {
      valueInput.classList.toggle('concealed', hideSecret.checked);
      hideSecret.addEventListener('change', () => {
        valueInput.classList.toggle('concealed', hideSecret.checked);
      });
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (valueError) valueError.textContent = '';
      if (nameError) nameError.textContent = '';
      vscode.postMessage({
        type: 'submit',
        payload: {
          name: nameInput ? nameInput.value : undefined,
          value: valueInput ? valueInput.value : '',
          description: descriptionInput ? descriptionInput.value : ''
        }
      });
    });

    cancelButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type === 'validation') {
        if (valueError) valueError.textContent = message.valueError ?? '';
        if (nameError) nameError.textContent = message.nameError ?? '';
      }
    });
  </script>
</body>
</html>`;
}

export async function promptValueForm(options: ValueFormOptions): Promise<ValueFormResult | undefined> {
  const panel = vscode.window.createWebviewPanel('giteaActionsValueForm', options.title, vscode.ViewColumn.Active, {
    enableScripts: true
  });
  panel.webview.html = createFormHtml(options);

  return new Promise<ValueFormResult | undefined>((resolve) => {
    let settled = false;

    const finish = (result: ValueFormResult | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      messageDisposable.dispose();
      disposeDisposable.dispose();
      panel.dispose();
      resolve(result);
    };

    const messageDisposable = panel.webview.onDidReceiveMessage((message: SubmitMessage | { type?: string }) => {
      if (message?.type === 'cancel') {
        finish(undefined);
        return;
      }
      if (message?.type !== 'submit') {
        return;
      }

      const rawName = (message.payload.name ?? '').trim();
      const value = message.payload.value ?? '';
      const description = (message.payload.description ?? '').trim();

      const nameError = options.includeName
        ? !rawName
          ? `${options.nameLabel} cannot be empty`
          : options.validateName?.(rawName)
        : undefined;
      const valueError = !value.trim() ? `${options.valueLabel} cannot be empty` : undefined;

      if (nameError || valueError) {
        void panel.webview.postMessage({
          type: 'validation',
          nameError,
          valueError
        });
        return;
      }

      finish({
        name: options.includeName ? rawName : undefined,
        value,
        description: description || undefined
      });
    });

    const disposeDisposable = panel.onDidDispose(() => {
      if (!settled) {
        settled = true;
        messageDisposable.dispose();
        disposeDisposable.dispose();
        resolve(undefined);
      }
    });
  });
}
