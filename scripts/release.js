#!/usr/bin/env node

/**
 * Release script for VS Code extension
 * 
 * Usage:
 *   npm run release patch   # 1.0.0 -> 1.0.1
 *   npm run release minor   # 1.0.0 -> 1.1.0
 *   npm run release major   # 1.0.0 -> 2.0.0
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { updateChangelog } = require('./generate-changelog');

// Get repo root directory
const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const releaseType = process.argv[2];

// Helper to run git commands from repo root
function runGit(command, options = {}) {
  return execSync(command, {
    cwd: repoRoot,
    stdio: options.stdio || 'inherit',
    ...options
  });
}

if (!releaseType || !['patch', 'minor', 'major'].includes(releaseType)) {
  console.error('Usage: npm run release [patch|minor|major]');
  process.exit(1);
}

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;
const versionParts = currentVersion.split('.').map(Number);

// Bump version
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

// Generate changelog BEFORE bumping version (so we get commits up to now)
console.log('Generating changelog...');
const date = new Date().toISOString().split('T')[0];
const changelogEntry = updateChangelog(newVersion, date);
console.log('✅ Changelog generated');

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

// Tag current HEAD (no new commit — release whatever is already committed)
const tagName = `v${newVersion}`;
try {
  console.log(`Creating tag ${tagName} on current HEAD (no commit)...`);
  runGit(`git tag -a ${tagName} -m "Release ${tagName}"`);

  console.log('Pushing tag to remote...');
  runGit(`git push origin ${tagName}`);

  console.log('\n✅ Tag created and pushed!');
  console.log('   (package.json and CHANGELOG.md were updated locally but not committed; commit them if you want the repo to reflect the new version.)');
  
  // Try to create GitHub release automatically if gh CLI is available
  try {
    execSync('gh --version', { stdio: 'ignore' });
    console.log('\n🚀 GitHub CLI detected. Creating release...');
    
    // Write release notes to a temporary file (gh CLI supports reading from file)
    const releaseNotesPath = path.join(__dirname, '..', '.release-notes.md');
    fs.writeFileSync(releaseNotesPath, changelogEntry);
    
    try {
      // Use relative path for release notes file
      const relativeReleaseNotesPath = path.relative(repoRoot, releaseNotesPath);
      runGit(
        `gh release create ${tagName} --title "${tagName}" --notes-file "${relativeReleaseNotesPath}"`,
        { stdio: 'inherit' }
      );
    } finally {
      // Clean up temp file
      if (fs.existsSync(releaseNotesPath)) {
        fs.unlinkSync(releaseNotesPath);
      }
    }
    
    console.log(`\n✅ Release created! The GitHub Action will now automatically publish to VS Code Marketplace.`);
    console.log(`   View release: https://github.com/tarkilhk/gitea-actions-vscode-plugin/releases/tag/${tagName}`);
  } catch (ghError) {
    // GitHub CLI not available or failed
    console.log(`\n📦 Next steps:`);
    console.log(`   1. Create a release at: https://github.com/tarkilhk/gitea-actions-vscode-plugin/releases/new`);
    console.log(`   2. Select tag: ${tagName}`);
    console.log(`   3. Add release notes and click "Publish release"`);
    console.log(`   4. The GitHub Action will automatically publish to VS Code Marketplace`);
    console.log(`\n   💡 Tip: Install GitHub CLI (gh) to automate release creation:`);
    console.log(`      https://cli.github.com/`);
  }
  
} catch (error) {
  console.error('❌ Error:', error.message);
  // Revert package.json on error
  packageJson.version = currentVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  process.exit(1);
}
