import { describe, expect, it } from 'vitest';
import {
  activeMatch,
  addAction,
  closePeriod,
  createInitialNotebook,
  finishMatch,
  makeBackup,
  matchPoints,
  parseBackup,
  periodPoints,
  periodScore,
  playerStats,
  startMatch,
  undoAction,
  validateNotebook,
  type Action,
  type Match,
  type MatchPlayer,
} from './domain';

function start(notebook = createInitialNotebook()): Match {
  const players: MatchPlayer[] = notebook.roster.slice(0, 10).map((player, index) => ({
    ...player,
    number: String(index + 1),
  }));
  return activeMatch(startMatch(notebook, '  Adversaire  ', true, players))!;
}

describe('domain', () => {
  it('creates a valid initial notebook and snapshots ten players in a match', () => {
    const notebook = createInitialNotebook();
    expect(notebook.roster).toHaveLength(14);
    expect(validateNotebook(notebook)).toBe(true);

    const next = startMatch(notebook, ' Adversaire ', true, notebook.roster.slice(0, 10)
      .map((player, index) => ({ ...player, number: String(index + 1) })));
    expect(notebook.matches).toHaveLength(0);
    expect(activeMatch(next)?.opponent).toBe('Adversaire');
    expect(activeMatch(next)?.periods).toHaveLength(8);
  });

  it('accepts between six and ten selected players and rejects counts outside that range', () => {
    const notebook = createInitialNotebook();
    for (const count of [6, 10]) {
      const players = notebook.roster.slice(0, count).map((player, index) => ({
        ...player,
        number: String(index + 4),
      }));
      expect(activeMatch(startMatch(notebook, 'Adversaire', true, players))?.players).toHaveLength(count);
    }

    const tooFew = notebook.roster.slice(0, 5).map((player, index) => ({
      ...player,
      number: String(index + 4),
    }));
    const tooMany = notebook.roster.slice(0, 11).map((player, index) => ({
      ...player,
      number: String(index + 4),
    }));
    expect(() => startMatch(notebook, 'Adversaire', true, tooFew)).toThrow(/between 6 and 10/);
    expect(() => startMatch(notebook, 'Adversaire', true, tooMany)).toThrow(/between 6 and 10/);
  });

  it('rejects duplicate numbers even when their strings differ', () => {
    const notebook = createInitialNotebook();
    const players = notebook.roster.slice(0, 10).map((player, index) => ({
      ...player,
      number: index < 2 ? (index === 0 ? '04' : '4') : String(index + 1),
    }));
    expect(() => startMatch(notebook, 'Adversaire', true, players)).toThrow();
  });

  it('allows different players to have the same name', () => {
    const notebook = createInitialNotebook();
    notebook.roster[1].name = notebook.roster[0].name;
    expect(validateNotebook(notebook)).toBe(true);
    expect(() => startMatch(notebook, 'Adversaire', true, notebook.roster.slice(0, 10)
      .map((player, index) => ({ ...player, number: String(index + 1) })))).not.toThrow();
  });

  it('scores points, match points, player stats, and immutable undo correctly', () => {
    const match = start();
    const actions: Action[] = [
      { id: 'a1', team: 'alm', kind: 'points', value: 2, playerId: match.players[0].id },
      { id: 'a2', team: 'opponent', kind: 'points', value: 1, playerId: null },
      { id: 'a3', team: 'alm', kind: 'foul', value: 1, playerId: match.players[0].id },
    ];
    const withActions = actions.reduce((current, action) => addAction(current, action), match);

    expect(periodScore(withActions.periods[0])).toEqual({ alm: 2, opponent: 1 });
    expect(playerStats(withActions, match.players[0].id)).toEqual({ points: 2, fouls: 1 });
    expect(match.periods[0].actions).toHaveLength(0);

    const closed = closePeriod(withActions);
    expect(periodPoints(closed.periods[0])).toEqual({ alm: 3, opponent: 1 });
    expect(matchPoints(closed)).toEqual({ alm: 3, opponent: 1 });
    expect(undoAction(withActions).periods[0].actions).toHaveLength(2);
    expect(() => undoAction(closed)).toThrow();
  });

  it('keeps eight closed periods active until the match is explicitly finished', () => {
    let match = start();
    expect(() => finishMatch(match)).toThrow(/All periods must be closed/);
    for (let period = 0; period < 8; period += 1) match = closePeriod(match);
    expect(match.finishedAt).toBeNull();
    expect(matchPoints(match)).toEqual({ alm: 16, opponent: 16 });
    const restored = parseBackup(makeBackup({ ...createInitialNotebook(), matches: [match] }));
    expect(activeMatch(restored)).toEqual(match);
    const lateAction: Action = {
      id: 'late', team: 'opponent', kind: 'points', value: 1, playerId: null,
    };
    expect(() => addAction(match, lateAction)).toThrow(/no open period/);
    expect(() => undoAction(match)).toThrow(/no open period/);
    expect(() => closePeriod(match)).toThrow(/no open period/);
    const finished = finishMatch(match);
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.periods).toEqual(match.periods);
    expect(activeMatch({ ...restored, matches: [finished] })).toBeNull();
    expect(() => addAction(finished, lateAction)).toThrow(/match is finished/);
  });

  it('round-trips v2 backups and imports v1 while preserving legacy team fields', () => {
    const notebook = createInitialNotebook();
    const legacy = { name: 'Équipe historique', customField: { keep: true } };
    const imported = parseBackup({
      version: 1,
      notebook: { ...notebook, teams: [legacy], trackFouls: true },
    });
    expect(imported.teams).toEqual([legacy]);
    expect(imported.trackFouls).toBe(true);
    expect(parseBackup(makeBackup(imported))).toEqual(imported);
  });

  it('rejects unknown legacy matches instead of silently losing them', () => {
    expect(() => parseBackup({ version: 1, notebook: { teams: [], matches: [{ unknown: true }] } })).toThrow();
  });

  it('round-trips optional preferred numbers and rejects invalid ones in backups', () => {
    const notebook = createInitialNotebook();
    notebook.roster[0].preferredNumber = '09';
    const restored = parseBackup(makeBackup(notebook));
    expect(restored.roster[0].preferredNumber).toBe('09');
    expect(restored.roster[1].preferredNumber).toBeUndefined();
    notebook.roster[0].preferredNumber = '000';
    expect(() => parseBackup({ version: 2, notebook })).toThrow();
  });
});
