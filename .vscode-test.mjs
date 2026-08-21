import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/integration/**/*.test.js',
  mocha: {
    ui: 'bdd',
    timeout: 120000,
    color: true
  },
  launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
  env: {
    GITEA_URL: process.env.GITEA_URL,
    GITEA_TOKEN: process.env.GITEA_TOKEN,
    GITEA_REPO: process.env.GITEA_REPO
  }
});
