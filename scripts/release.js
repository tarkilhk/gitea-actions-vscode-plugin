#!/usr/bin/env node

/**
 * Release script for VS Code extension
 *
 * Usage:
 *   npm run release patch   # 1.0.0 -> 1.0.1
 *   npm run release minor   # 1.0.0 -> 1.1.0
 *   npm run release major   # 1.0.0 -> 2.0.0
 *
 * Update CHANGELOG.md manually before running this script (section ## [newVersion]).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const releaseType = process.argv[2];

function runGit(command, options = {}) {
  return execSync(command, {
    cwd: repoRoot,
    stdio: options.stdio || 'inherit',
    ...options
  });
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

if (!releaseType || !['patch', 'minor', 'major'].includes(releaseType)) {
  console.error('Usage: npm run release [patch|minor|major]');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;
const versionParts = currentVersion.split('.').map(Number);

let newVersion;
switch (releaseType) {
  case 'patch':
    versionParts[2]++;
    break;
  case 'minor':
    versionParts[1]++;
    versionParts[2] = 0;
    break;
  case 'major':
    versionParts[0]++;
    versionParts[1] = 0;
    versionParts[2] = 0;
    break;
}
newVersion = versionParts.join('.');

console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);

const changelogPreview = extractChangelogSection(newVersion);
if (!changelogPreview) {
  console.warn(
    `⚠️  No "## [${newVersion}]" section found in CHANGELOG.md. Add it before release, or edit after and amend.`
  );
  console.warn('   GitHub CLI releases will use auto-generated notes if available.\n');
} else {
  console.log(`✅ Found CHANGELOG section for ${newVersion}\n`);
}

packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

const tagName = `v${newVersion}`;
try {
  console.log('Committing version bump...');
  runGit('git add package.json CHANGELOG.md');
  runGit(`git commit -m "chore: bump version to ${newVersion}"`);

  console.log(`Creating tag ${tagName}...`);
  runGit(`git tag -a ${tagName} -m "Release ${tagName}"`);

  console.log('Pushing to GitHub...');
  runGit('git push origin HEAD');
  runGit(`git push origin ${tagName}`);

  console.log('\n✅ Version bumped and pushed!');

  try {
    execSync('gh --version', { stdio: 'ignore' });
    console.log('\n🚀 GitHub CLI detected. Creating release...');

    const releaseNotesPath = path.join(repoRoot, '.release-notes.md');
    const notesFromChangelog = changelogPreview;
    try {
      if (notesFromChangelog) {
        fs.writeFileSync(releaseNotesPath, notesFromChangelog);
        const relativeReleaseNotesPath = path.relative(repoRoot, releaseNotesPath);
        runGit(
          `gh release create ${tagName} --title "${tagName}" --notes-file "${relativeReleaseNotesPath}"`,
          { stdio: 'inherit' }
        );
      } else {
        runGit(`gh release create ${tagName} --title "${tagName}" --generate-notes`, { stdio: 'inherit' });
      }
    } finally {
      if (fs.existsSync(releaseNotesPath)) {
        fs.unlinkSync(releaseNotesPath);
      }
    }

    console.log(`\n✅ Release created! The GitHub Action will now automatically publish to VS Code Marketplace.`);
    console.log(`   View release: https://github.com/tarkilhk/gitea-actions-vscode-plugin/releases/tag/${tagName}`);
  } catch (ghError) {
    console.log(`\n📦 Next steps:`);
    console.log(`   1. Create a release at: https://github.com/tarkilhk/gitea-actions-vscode-plugin/releases/new`);
    console.log(`   2. Select tag: ${tagName}`);
    console.log(`   3. Paste notes from CHANGELOG.md (section ## [${newVersion}]) and click "Publish release"`);
    console.log(`   4. The GitHub Action will automatically publish to VS Code Marketplace`);
    console.log(`\n   💡 Tip: Install GitHub CLI (gh) to automate release creation:`);
    console.log(`      https://cli.github.com/`);
  }
} catch (error) {
  console.error('❌ Error:', error.message);
  packageJson.version = currentVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  process.exit(1);
}
