#!/usr/bin/env node

/**
 * Generates changelog from git commits between tags
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get repo root directory
const repoRoot = path.resolve(__dirname, '..');

function getLastTag() {
  try {
    const tag = execSync('git describe --tags --abbrev=0', { 
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'] // Suppress stderr to avoid "No names found" message
    }).trim();
    return tag;
  } catch (error) {
    // No tags found, return empty
    return null;
  }
}

function getCommitsSinceTag(tag) {
  try {
    const range = tag ? `${tag}..HEAD` : 'HEAD';
    const commits = execSync(
      `git log ${range} --pretty=format:"%h|%s|%an" --no-merges`,
      { 
        cwd: repoRoot,
        encoding: 'utf8' 
      }
    ).trim();
    
    if (!commits) return [];
    
    return commits.split('\n').map(line => {
      const [hash, message, author] = line.split('|');
      return { hash, message, author };
    });
  } catch (error) {
    return [];
  }
}

function categorizeCommit(message) {
  const lowerMessage = message.toLowerCase();
  
  // Skip version bump commits
  if (message.includes('bump version') || message.includes('chore:')) {
    return null;
  }
  
  // Conventional commits format
  if (message.match(/^(feat|feature)[(:]/i)) {
    return { type: 'Added', icon: '✨' };
  }
  if (message.match(/^(fix|bugfix)[(:]/i)) {
    return { type: 'Fixed', icon: '🐛' };
  }
  if (message.match(/^(refactor)[(:]/i)) {
    return { type: 'Changed', icon: '♻️' };
  }
  if (message.match(/^(perf|performance)[(:]/i)) {
    return { type: 'Changed', icon: '⚡' };
  }
  if (message.match(/^(docs|documentation)[(:]/i)) {
    return { type: 'Changed', icon: '📝' };
  }
  if (message.match(/^(style)[(:]/i)) {
    return { type: 'Changed', icon: '💄' };
  }
  if (message.match(/^(test)[(:]/i)) {
    return { type: 'Changed', icon: '✅' };
  }
  if (message.match(/^(chore)[(:]/i)) {
    return null; // Skip chores
  }
  if (message.match(/^(breaking|break)[(:]/i)) {
    return { type: 'Breaking Changes', icon: '💥' };
  }
  
  // Fallback categorization based on keywords
  if (lowerMessage.includes('add') || lowerMessage.includes('new') || lowerMessage.includes('implement')) {
    return { type: 'Added', icon: '✨' };
  }
  if (lowerMessage.includes('fix') || lowerMessage.includes('bug') || lowerMessage.includes('error')) {
    return { type: 'Fixed', icon: '🐛' };
  }
  if (lowerMessage.includes('update') || lowerMessage.includes('change') || lowerMessage.includes('improve')) {
    return { type: 'Changed', icon: '♻️' };
  }
  
  // Default
  return { type: 'Changed', icon: '📝' };
}

function generateChangelogEntry(version, date, commits) {
  const categorized = {};
  
  commits.forEach(commit => {
    const category = categorizeCommit(commit.message);
    if (!category) return;
    
    if (!categorized[category.type]) {
      categorized[category.type] = [];
    }
    
    // Clean up commit message (remove prefix if present)
    let cleanMessage = commit.message;
    const match = cleanMessage.match(/^[^:]+:\s*(.+)/);
    if (match) {
      cleanMessage = match[1];
    }
    
    categorized[category.type].push({
      message: cleanMessage,
      hash: commit.hash,
      icon: category.icon
    });
  });
  
  let changelog = `## [${version}] - ${date}\n\n`;
  
  const order = ['Added', 'Fixed', 'Changed', 'Breaking Changes'];
  order.forEach(type => {
    if (categorized[type] && categorized[type].length > 0) {
      const items = categorized[type];
      const icon = items[0].icon;
      changelog += `### ${icon} ${type}\n\n`;
      items.forEach(item => {
        changelog += `- ${item.message} (${item.hash})\n`;
      });
      changelog += '\n';
    }
  });
  
  // Add uncategorized if any
  const allTypes = Object.keys(categorized);
  const uncategorized = allTypes.filter(t => !order.includes(t));
  if (uncategorized.length > 0) {
    uncategorized.forEach(type => {
      const items = categorized[type];
      const icon = items[0].icon;
      changelog += `### ${icon} ${type}\n\n`;
      items.forEach(item => {
        changelog += `- ${item.message} (${item.hash})\n`;
      });
      changelog += '\n';
    });
  }
  
  if (Object.keys(categorized).length === 0) {
    changelog += '- Maintenance release\n\n';
  }
  
  return changelog;
}

function updateChangelog(version, date) {
  const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
  const lastTag = getLastTag();
  const commits = getCommitsSinceTag(lastTag);
  
  const newEntry = generateChangelogEntry(version, date, commits);
  
  let existingChangelog = '';
  if (fs.existsSync(changelogPath)) {
    existingChangelog = fs.readFileSync(changelogPath, 'utf8');
  }
  
  // Remove "Unreleased" section if it exists
  existingChangelog = existingChangelog.replace(/## \[Unreleased\].*?(?=## |$)/s, '');
  
  // Create header if file doesn't exist
  let header = '';
  if (!existingChangelog.includes('# Changelog')) {
    header = '# Changelog\n\n';
    header += 'All notable changes to this project will be documented in this file.\n\n';
    header += 'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),\n';
    header += 'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n';
  }
  
  const updatedChangelog = header + newEntry + existingChangelog;
  fs.writeFileSync(changelogPath, updatedChangelog);
  
  return newEntry;
}

// Export for use in release script
if (require.main === module) {
  const version = process.argv[2];
  const date = new Date().toISOString().split('T')[0];
  
  if (!version) {
    console.error('Usage: node generate-changelog.js <version>');
    process.exit(1);
  }
  
  const entry = updateChangelog(version, date);
  console.log('✅ Changelog updated!');
  console.log('\n' + entry);
} else {
  module.exports = { updateChangelog, generateChangelogEntry };
}
