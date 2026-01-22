# Contributing to Gitea Actions VS Code Extension

Thank you for your interest in contributing! This document covers the development setup and project structure.

## Development Setup

### Prerequisites

- Node.js 18+
- npm 9+
- VS Code or Cursor

### Getting Started

```bash
# Clone the repository
git clone https://github.com/tarkilhk/gitea-actions-vscode-plugin.git
cd gitea-actions-vscode-plugin

# Install dependencies
npm install

# Build the extension
npm run compile

# Or watch for changes during development
npm run watch
```

### Running the Extension

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. The extension will be active in the new window

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run compile` | Build for production |
| `npm run watch` | Build and watch for changes |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run package` | Create a VSIX package |
| `npm run release` | Create a new release |

## Project Structure

```
src/
├── commands/              # Command handlers
│   ├── tokenCommands.ts   # Set/clear/test token
│   ├── secretCommands.ts  # Secrets CRUD operations
│   ├── variableCommands.ts # Variables CRUD operations
│   └── runCommands.ts     # View logs, open browser, pin/unpin
│
├── services/              # Core services
│   ├── logStreamService.ts   # Live log streaming
│   ├── statusBarService.ts   # Status bar & toast notifications
│   └── refreshService.ts     # Data refresh logic
│
├── config/                # Configuration
│   ├── settings.ts        # VS Code settings access
│   ├── secrets.ts         # Token storage (SecretStorage)
│   └── constants.ts       # Timing constants
│
├── controllers/           # Controllers
│   ├── commands.ts        # Command registration
│   └── refreshController.ts # Adaptive polling controller
│
├── gitea/                 # Gitea API layer
│   ├── client.ts          # HTTP client (undici)
│   ├── api.ts             # API methods & response mapping
│   ├── models.ts          # TypeScript interfaces
│   └── discovery.ts       # Repository discovery from git remotes
│
├── views/                 # UI components
│   ├── actionsTreeProvider.ts  # Main tree view provider
│   ├── settingsTreeProvider.ts # Settings tree view provider
│   ├── nodes.ts           # Tree node definitions
│   └── icons.ts           # Status icons
│
├── util/                  # Utilities
│   ├── status.ts          # Status normalization
│   ├── time.ts            # Time formatting
│   ├── errors.ts          # Error handling helpers
│   └── logging.ts         # Output channel logging
│
├── __mocks__/             # Test mocks
│   └── vscode.ts          # VS Code API mock
│
└── extension.ts           # Extension entry point
```

## Testing

The project uses [Vitest](https://vitest.dev/) for testing.

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

### Test Files

Tests are co-located with source files using the `.test.ts` suffix:

- `src/util/time.test.ts` — Time formatting utilities
- `src/util/status.test.ts` — Status normalization
- `src/gitea/api.test.ts` — API response mapping
- `src/gitea/discovery.test.ts` — Git remote parsing
- `src/gitea/internalApi.test.ts` — Internal API for job steps
- `src/views/actionsTreeProvider.test.ts` — Tree provider expansion state and targeted refresh
- `src/services/refreshService.test.ts` — Repo list diffing logic

### Writing Tests

Tests use a VS Code mock located at `src/__mocks__/vscode.ts`. Import from vitest:

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from './myModule';

describe('myFunction', () => {
  it('should do something', () => {
    expect(myFunction('input')).toBe('output');
  });
});
```

## Architecture

### Extension Lifecycle

1. **Activation** (`extension.ts`) — Initializes providers, registers commands, starts refresh controller
2. **Refresh Controller** — Manages adaptive polling (faster when active, slower when idle)
3. **Tree Providers** — Render workflow runs, jobs, and settings
4. **Commands** — Handle user actions (set token, view logs, etc.)

### Data Flow

```
Gitea API → GiteaClient → GiteaApi → RefreshService → TreeProviders → UI
```

### Key Patterns

- **Context objects** — Commands receive context objects with dependencies (avoid global state)
- **Barrel exports** — Each directory has an `index.ts` for clean imports
- **Defensive mapping** — API responses are normalized to handle various Gitea versions
- **Targeted refresh** — Only active (running/queued) runs trigger UI updates; completed runs are final and never refreshed during polling

### Refresh Strategy

The refresh system is optimized to preserve tree expansion state:

1. **Repo diffing** — `setRepositories()` only called when the repo list actually changes
2. **Active-only refresh** — During polling, only active runs fetch jobs and trigger UI updates
3. **Conditional loading indicators** — Loading state only shown on first load or error recovery
4. **Granular tree updates** — Individual nodes are refreshed instead of the entire tree when possible

## Code Style

- TypeScript strict mode enabled
- ESLint with TypeScript rules
- Prefer `const` and explicit types
- Use async/await over raw promises

## Releasing

Releases are automated via GitHub Actions when a release is created on GitHub.

```bash
# Create a release (bumps version, updates changelog, creates tag)
npm run release:patch  # 1.0.0 → 1.0.1
npm run release:minor  # 1.0.0 → 1.1.0
npm run release:major  # 1.0.0 → 2.0.0
```

## API Reference

The `docs/api/` directory contains Gitea API specification files for reference during development.

## Questions?

Open an issue on GitHub if you have questions or run into problems.
