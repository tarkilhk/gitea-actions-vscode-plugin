#!/usr/bin/env node

/**
 * Release script for VS Code extension.
 *
 * Usage:
 *   npm run release:current # release the version already in package.json
 *   npm run release:patch   # 1.0.0 -> 1.0.1, then release
 *   npm run release:minor   # 1.0.0 -> 1.1.0, then release
 *   npm run release:major   # 1.0.0 -> 2.0.0, then release
 *
 * Update CHANGELOG.md manually before running this script.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageLockPath = path.join(repoRoot, 'package-lock.json');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const releaseType = process.argv[2];
const allowedReleaseTypes = ['current', 'patch', 'minor', 'major'];

function run(command, options = {}) {
  return execSync(command, {
    cwd: repoRoot,
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio ?? 'pipe',
    ...options
  });
}

function runInherit(command) {
  return run(command, { stdio: 'inherit', encoding: undefined });
}

function commandSucceeds(command) {
  try {
    run(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function bumpVersion(version, type) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  if (type === 'patch') {
    parts[2] += 1;
  } else if (type === 'minor') {
    parts[1] += 1;
    parts[2] = 0;
  } else if (type === 'major') {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  }
  return parts.join('.');
}

/**
 * Returns the CHANGELOG.md block for ## [version] ... up to the next ## [ or EOF.
 * Used for GitHub release notes when `gh` is available.
 */
function extractChangelogSection(version) {
  if (!fs.existsSync(changelogPath)) {
    return null;
  }
  const content = fs.readFileSync(changelogPath, 'utf8');
  const needle = `## [${version}]`;
  const idx = content.indexOf(needle);
  if (idx === -1) {
    return null;
  }
  const after = content.slice(idx);
  const nextMatch = after.slice(needle.length).match(/\n## \[/);
  const block = nextMatch ? after.slice(0, needle.length + nextMatch.index) : after;
  const trimmed = block.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function packageLockVersions() {
  if (!fs.existsSync(packageLockPath)) {
    return { root: undefined, packageRoot: undefined };
  }
  const lock = readJson(packageLockPath);
  return {
    root: lock.version,
    packageRoot: lock.packages?.['']?.version
  };
}

function updatePackageLockVersion(version) {
  if (!fs.existsSync(packageLockPath)) {
    return;
  }
  const lock = readJson(packageLockPath);
  lock.version = version;
  if (lock.packages?.['']) {
    lock.packages[''].version = version;
  }
  writeJson(packageLockPath, lock);
}

function hasStagedChanges() {
  return !commandSucceeds('git diff --cached --quiet');
}

function hasWorkingTreeChanges() {
  return !commandSucceeds('git diff --quiet');
}

function hasUntrackedFiles() {
  return run('git ls-files --others --exclude-standard').trim().length > 0;
}

function hasAnyChanges() {
  return hasStagedChanges() || hasWorkingTreeChanges() || hasUntrackedFiles();
}

function ensureChangelog(version) {
  const changelogPreview = extractChangelogSection(version);
  if (!changelogPreview) {
    throw new Error(`No "## [${version}]" section found in CHANGELOG.md.`);
  }
  console.log(`✅ Found CHANGELOG section for ${version}`);
  return changelogPreview;
}

function ensurePackageLockMatches(version) {
  const lockVersions = packageLockVersions();
  if (!lockVersions.root && !lockVersions.packageRoot) {
    return;
  }
  if (lockVersions.root !== version || lockVersions.packageRoot !== version) {
    throw new Error(
      `package-lock.json version mismatch: root=${lockVersions.root}, package=${lockVersions.packageRoot}, expected=${version}`
    );
  }
}

function ensureTagDoesNotExist(tagName) {
  const existing = run(`git tag --list ${tagName}`).trim();
  if (existing === tagName) {
    throw new Error(`Tag ${tagName} already exists.`);
  }
}

function createGithubRelease(tagName, releaseNotes) {
  try {
    execSync('gh --version', { stdio: 'ignore' });
  } catch {
    console.log('\n📦 Next steps:');
    console.log(`   1. Create a release at: https://github.com/tarkilhk/gitea-actions-vscode-plugin/releases/new`);
    console.log(`   2. Select tag: ${tagName}`);
    console.log(`   3. Paste notes from CHANGELOG.md and click "Publish release"`);
    console.log(`   4. The GitHub Action will automatically publish to VS Code Marketplace`);
    console.log('\n   💡 Tip: Install GitHub CLI (gh) to automate release creation:');
    console.log('      https://cli.github.com/');
    return;
  }

  console.log('\n🚀 GitHub CLI detected. Creating release...');
  const releaseNotesPath = path.join(repoRoot, '.release-notes.md');
  try {
    fs.writeFileSync(releaseNotesPath, releaseNotes);
    const relativeReleaseNotesPath = path.relative(repoRoot, releaseNotesPath);
    runInherit(`gh release create ${tagName} --title "${tagName}" --notes-file "${relativeReleaseNotesPath}"`);
  } finally {
    if (fs.existsSync(releaseNotesPath)) {
      fs.unlinkSync(releaseNotesPath);
    }
  }

  console.log('\n✅ Release created! The GitHub Action will now automatically publish to VS Code Marketplace.');
  console.log(`   View release: https://github.com/tarkilhk/gitea-actions-vscode-plugin/releases/tag/${tagName}`);
}

function usage() {
  console.error('Usage: npm run release [current|patch|minor|major]');
}

if (!releaseType || !allowedReleaseTypes.includes(releaseType)) {
  usage();
  process.exit(1);
}

const packageJson = readJson(packageJsonPath);
const currentVersion = packageJson.version;
const newVersion = releaseType === 'current' ? currentVersion : bumpVersion(currentVersion, releaseType);
const tagName = `v${newVersion}`;

try {
  if (releaseType === 'current') {
    console.log(`Releasing current version: ${newVersion}`);
    ensurePackageLockMatches(newVersion);
  } else {
    console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);
    packageJson.version = newVersion;
    writeJson(packageJsonPath, packageJson);
    updatePackageLockVersion(newVersion);
  }

  const changelogPreview = ensureChangelog(newVersion);
  ensureTagDoesNotExist(tagName);

  if (!hasAnyChanges()) {
    throw new Error('No local changes to commit. Did you already commit this release?');
  }

  console.log('Running release checks...');
  runInherit('npm test');
  runInherit('npm run lint');
  runInherit('npm run compile');

  console.log('Committing release changes...');
  runInherit('git add -A');
  runInherit(`git commit -m "chore: release ${newVersion}"`);

  console.log(`Creating tag ${tagName}...`);
  runInherit(`git tag -a ${tagName} -m "Release ${tagName}"`);

  console.log('Pushing to GitHub...');
  runInherit('git push origin HEAD');
  runInherit(`git push origin ${tagName}`);

  console.log('\n✅ Release commit and tag pushed!');
  createGithubRelease(tagName, changelogPreview);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
