# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] - 2026-05-02

### 🐛 Fixed

- Fix lint issues in diagnostics and API tests (64f42c1)

### 📝 Changed

- Refactor Gitea Actions workflow handling (4807135)
- Cleanup (98d3813)

## [2.4.0] - 2026-04-30

### ✨ Added

- Address issue #3 (724e5ad)
- Normalize escaped newlines for secrets and variables (4c4e2c1)

### 🐛 Fixed

- update Gitea Actions diagnose steps and status icons (f3ba09b)
- Fix allAccessible discovery to query accessible repos via /repos/search (b9096a9)

### 📝 Changed

- Tighten allAccessible fallback behavior and pagination (b68adca)

## [2.3.12] - 2026-02-10

### ✨ Added

- add diagnose steps action and improve error handling for Gitea Actions (b2b3c96)

## [2.3.11] - 2026-02-03

### ✨ Added

- add new actions for managing secrets and variables in Gitea Actions settings + auto log streaming (fb3cf09)

## [2.3.10] - 2026-02-02

- Re add icons and actions to edit/delete token, secrets, and variables

## [2.3.7] - 2026-02-01

### ✨ Added

- enhance Gitea integration with improved step handling and error reporting (0dc2fda)

## [2.3.6] - 2026-01-23

### ✨ Added

- add new context menu actions for job and run items (eb8ffbe)

## [2.3.5] - 2026-01-23

### ♻️ Changed

- streamline command handling and update context menu actions (91c7d04)

## [2.3.4] - 2026-01-22

### ✨ Added

- update icons and settings messages for improved clarity (0e9f69b)
- enhance Gitea API and internal API with improved header management (42ac7ae)

## [2.3.3] - 2026-01-22

### ✨ Added

- enhance ActionsTreeProvider with improved node management (04473b9)

## [2.3.2] - 2026-01-22

### ✨ Added

- implement refresh logic for expanded runs (521df44)

## [2.3.1] - 2026-01-22

### ✨ Added

- update Gitea Actions configuration options and improve README (1650213)
- add 'Open Settings' command to Gitea Actions (53a9016)

## [2.3.0] - 2026-01-22

### ✨ Added

- add configurable polling intervals for job refresh and log streaming (e6a2db8)

## [2.2.3] - 2026-01-22

### 🐛 Fixed

- reduce idle polling interval and improve job cache management (d43b0ec)

## [2.2.2] - 2026-01-22

### ✨ Added

- enhance job fetching for expanded runs (45e40e3)

## [2.2.1] - 2026-01-22

- Support Antigravity for @jacobleft

## [2.1.7] - 2026-01-22

### ✨ Added

- implement targeted refresh strategy for active runs (bed050c)

## [2.1.6] - 2026-01-22

### ✨ Added

- preserve tree view expansion state across refreshes (b60c1b0)

## [2.1.5] - 2026-01-15

### ✨ Added

- improve run node refresh logic in ActionsTreeProvider (2fea930)

## [2.1.4] - 2026-01-15

- Maintenance release

## [2.1.3] - 2026-01-15

### ✨ Added

- enhance TreeItem IDs for better context and organization (a646d10)

## [2.1.2] - 2026-01-15

### ✨ Added

- enhance job step hydration with force refresh option (a6f20bb)

## [2.1.1] - 2026-01-10

### 📝 Changed

- update README for Gitea Actions extension (5a95749)

## [2.1.0] - 2026-01-10

### ✨ Added

- add step-specific log viewing and enhance log streaming functionality (f8e6db4)

### ♻️ Changed

- remove pinned repository functionality and update discovery mode (00dfffb)

## [2.0.3] - 2026-01-10

- Maintenance release

## [2.0.2] - 2026-01-10

### 🐛 Fixed

- update status icon for queued state and enhance sorting logic (c0cdecd)

## [2.0.1] - 2026-01-10

### ♻️ Changed

- update package.json for extension visibility (e6839a4)

## [2.0.0] - 2026-01-09

### ✨ Added

- - Added a changelog file to document notable changes following the Keep a Changelog format. - Updated package.json and package-lock.json to reflect the new version 1.6.0. - Enhanced dependencies for testing and coverage, including Vitest and related packages. - Removed outdated swagger files and cache utility to streamline the project structure. (dbe88bf)

## [1.6.0] - 2026-01-09

### ✨ Added

- add secrets and variables management to Gitea Actions extension (abf2b64)

## [1.5.0] - 2026-01-09

### ✨ Added

- enhance job and step logging in Gitea Actions extension (15c40b2)

## [1.4.1] - 2026-01-09

- Maintenance release

## [1.4.0] - 2026-01-09

### ✨ Added

- Add Github actions to build / deploy extension to marketplace on release (dbc8f26)

### 📝 Changed

- Remove package-lock.json from .gitignore (9fef59c)

## [1.3.0] - 2026-01-09

- Maintenance release

## [1.2.0] - 2026-01-09

- Maintenance release

## [1.1.0] - 2026-01-08

### ✨ Added

- Update package.json, README.md, and source files for version 1.0.0 release. Introduce new "Runs (Pinned)" view, enhance job fetching with limits, and improve logging. Update settings to include max jobs per run and refine UI elements for better user experience. (9483c16)

### 📝 Changed

- First _real_ commit (857ba0a)
- Initial commit (344af36)