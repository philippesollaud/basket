import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearStateForTests,
  database,
  loadState,
  RevisionConflictError,
  saveState,
} from './storage';
import { createInitialNotebook } from './domain';

describe('local notebook storage', () => {
  afterEach(async () => {
    await clearStateForTests();
  });

  it('initializes state and persists revisioned updates', async () => {
    const initial = await loadState();
    expect(initial.revision).toBe(0);

    const updated = { ...initial.data, trackFouls: true };
    const saved = await saveState(updated, initial.revision);
    expect(saved.revision).toBe(1);
    expect((await loadState()).data.trackFouls).toBe(true);
    expect((await loadState()).revision).toBe(1);
  });

  it('rejects stale revisions without overwriting the latest notebook', async () => {
    const first = await loadState();
    await saveState({ ...first.data, trackFouls: true }, first.revision);

    await expect(saveState({ ...first.data, trackFouls: false }, first.revision))
      .rejects.toBeInstanceOf(RevisionConflictError);
    expect((await loadState()).data.trackFouls).toBe(true);
  });

  it('validates data before writing and keeps the existing revision', async () => {
    const initial = await loadState();
    const invalid = { ...createInitialNotebook(), roster: [] };
    await expect(saveState(invalid, initial.revision)).rejects.toThrow();
    expect((await loadState()).revision).toBe(initial.revision);
    expect(database.name).toBe('basket-u11');
  });
});
