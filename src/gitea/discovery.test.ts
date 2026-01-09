import { describe, it, expect } from 'vitest';
import { parseRemote, hostsMatch } from './discovery';

describe('parseRemote', () => {
  describe('HTTPS URLs', () => {
    it('parses standard HTTPS URL', () => {
      const result = parseRemote('origin\thttps://github.com/owner/repo.git (fetch)');
      expect(result).toEqual({ host: 'github.com', owner: 'owner', name: 'repo' });
    });

    it('parses HTTPS URL without .git suffix', () => {
      const result = parseRemote('origin\thttps://github.com/owner/repo (fetch)');
      expect(result).toEqual({ host: 'github.com', owner: 'owner', name: 'repo' });
    });

    it('parses HTTPS URL with port', () => {
      const result = parseRemote('origin\thttps://gitea.example.com:3000/owner/repo.git (fetch)');
      expect(result).toEqual({ host: 'gitea.example.com:3000', owner: 'owner', name: 'repo' });
    });

    it('handles HTTP URLs', () => {
      const result = parseRemote('origin\thttp://localhost:3000/owner/repo.git (fetch)');
      expect(result).toEqual({ host: 'localhost:3000', owner: 'owner', name: 'repo' });
    });
  });

  describe('SSH URLs', () => {
    it('parses SSH protocol URL', () => {
      const result = parseRemote('origin\tssh://git@github.com/owner/repo.git (fetch)');
      expect(result).toEqual({ host: 'git@github.com', owner: 'owner', name: 'repo' });
    });

    it('parses SSH URL with port', () => {
      const result = parseRemote('origin\tssh://git@gitea.example.com:2222/owner/repo.git (push)');
      expect(result).toEqual({ host: 'git@gitea.example.com:2222', owner: 'owner', name: 'repo' });
    });
  });

  describe('SCP-style URLs', () => {
    it('parses SCP-style git URL', () => {
      const result = parseRemote('origin\tgit@github.com:owner/repo.git (fetch)');
      expect(result).toEqual({ host: 'github.com', owner: 'owner', name: 'repo' });
    });

    it('parses SCP-style URL without .git suffix', () => {
      const result = parseRemote('origin\tgit@github.com:owner/repo (push)');
      expect(result).toEqual({ host: 'github.com', owner: 'owner', name: 'repo' });
    });

    it('parses SCP-style URL with custom user', () => {
      const result = parseRemote('origin\tcustom@gitea.example.com:owner/repo.git (fetch)');
      expect(result).toEqual({ host: 'gitea.example.com', owner: 'owner', name: 'repo' });
    });
  });

  describe('Edge cases', () => {
    it('returns undefined for empty line', () => {
      expect(parseRemote('')).toBeUndefined();
    });

    it('returns undefined for line without URL', () => {
      expect(parseRemote('origin')).toBeUndefined();
    });

    it('returns undefined for invalid URL format', () => {
      expect(parseRemote('origin\tinvalid-url (fetch)')).toBeUndefined();
    });

    it('handles tab-separated fields', () => {
      const result = parseRemote('origin\thttps://github.com/owner/repo.git\t(fetch)');
      expect(result).toEqual({ host: 'github.com', owner: 'owner', name: 'repo' });
    });

    it('handles space-separated fields', () => {
      const result = parseRemote('origin  https://github.com/owner/repo.git (fetch)');
      expect(result).toEqual({ host: 'github.com', owner: 'owner', name: 'repo' });
    });
  });
});

describe('hostsMatch', () => {
  it('returns true for exact match', () => {
    expect(hostsMatch('github.com', 'github.com')).toBe(true);
  });

  it('returns true when hosts match ignoring port', () => {
    expect(hostsMatch('github.com', 'github.com:443')).toBe(true);
    expect(hostsMatch('github.com:443', 'github.com')).toBe(true);
  });

  it('returns true for both with same port', () => {
    expect(hostsMatch('github.com:443', 'github.com:443')).toBe(true);
  });

  it('returns true for different ports but same host', () => {
    expect(hostsMatch('example.com:3000', 'example.com:8080')).toBe(true);
  });

  it('returns false for different hosts', () => {
    expect(hostsMatch('github.com', 'gitlab.com')).toBe(false);
  });

  it('returns false for empty candidate', () => {
    expect(hostsMatch('', 'github.com')).toBe(false);
  });

  it('returns false for empty target', () => {
    expect(hostsMatch('github.com', '')).toBe(false);
  });

  it('returns false for both empty', () => {
    expect(hostsMatch('', '')).toBe(false);
  });

  it('handles localhost correctly', () => {
    expect(hostsMatch('localhost:3000', 'localhost')).toBe(true);
    expect(hostsMatch('localhost', 'localhost:8080')).toBe(true);
  });

  it('handles IP addresses', () => {
    expect(hostsMatch('192.168.1.1:3000', '192.168.1.1')).toBe(true);
    expect(hostsMatch('192.168.1.1', '192.168.1.2')).toBe(false);
  });
});
