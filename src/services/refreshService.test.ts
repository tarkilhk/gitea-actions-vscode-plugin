import { describe, it, expect } from 'vitest';
import { hasRepoListChanged } from './refreshService';

describe('hasRepoListChanged', () => {
  it('should return true when oldKeys is undefined (first load)', () => {
    const newKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    expect(hasRepoListChanged(undefined, newKeys)).toBe(true);
  });

  it('should return false when both sets are empty', () => {
    const oldKeys = new Set<string>();
    const newKeys = new Set<string>();
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(false);
  });

  it('should return false when sets are identical', () => {
    const oldKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    const newKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(false);
  });

  it('should return false when sets have same keys in different order', () => {
    const oldKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    const newKeys = new Set(['owner2/repo2', 'owner1/repo1']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(false);
  });

  it('should return true when a repo is added', () => {
    const oldKeys = new Set(['owner1/repo1']);
    const newKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(true);
  });

  it('should return true when a repo is removed', () => {
    const oldKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    const newKeys = new Set(['owner1/repo1']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(true);
  });

  it('should return true when a repo is replaced', () => {
    const oldKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    const newKeys = new Set(['owner1/repo1', 'owner3/repo3']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(true);
  });

  it('should return true when all repos change', () => {
    const oldKeys = new Set(['owner1/repo1', 'owner2/repo2']);
    const newKeys = new Set(['owner3/repo3', 'owner4/repo4']);
    expect(hasRepoListChanged(oldKeys, newKeys)).toBe(true);
  });
});
