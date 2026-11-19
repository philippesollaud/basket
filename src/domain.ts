import { z } from 'zod';

export type Player = { id: string; name: string; preferredNumber?: string };
export type MatchPlayer = { id: string; name: string; number: string };
export type Action = {
  id: string;
  team: 'alm' | 'opponent';
  kind: 'points' | 'foul';
  value: 1 | 2;
  playerId: string | null;
};
export type Period = { actions: Action[]; closed: boolean };
export type Match = {
  id: string;
  opponent: string;
  home: boolean;
  players: MatchPlayer[];
  periods: Period[];
  startedAt: string;
  finishedAt: string | null;
};
export type LegacyTeam = Record<string, unknown>;
export type Notebook = {
  roster: Player[];
  trackFouls: boolean;
  teams: LegacyTeam[];
  matches: Match[];
};

const nonEmptyString = z.string().trim().min(1);
const isoDate = z.string().refine(
  (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value)),
  'Invalid ISO date',
);
export function isJerseyNumber(value: string): boolean {
  return /^\d{1,3}$/.test(value) && Number(value) >= 1;
}

const jerseyNumberSchema = z.string().refine(isJerseyNumber);
const playerSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  preferredNumber: jerseyNumberSchema.optional(),
}).strict();
const matchPlayerSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  number: jerseyNumberSchema,
}).strict();
const actionSchema = z.object({
  id: nonEmptyString,
  team: z.enum(['alm', 'opponent']),
  kind: z.enum(['points', 'foul']),
  value: z.union([z.literal(1), z.literal(2)]),
  playerId: z.string().min(1).nullable(),
}).strict();
const periodSchema = z.object({
  actions: z.array(actionSchema),
  closed: z.boolean(),
}).strict();
const matchSchema = z.object({
  id: nonEmptyString,
  opponent: nonEmptyString,
  home: z.boolean(),
  players: z.array(matchPlayerSchema).min(6).max(10),
  periods: z.array(periodSchema).length(8),
  startedAt: isoDate,
  finishedAt: isoDate.nullable(),
}).strict();
const legacyTeamSchema = z.record(z.string(), z.unknown());
const notebookSchema = z.object({
  roster: z.array(playerSchema).length(14),
  trackFouls: z.boolean(),
  teams: z.array(legacyTeamSchema),
  matches: z.array(matchSchema),
}).strict();

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function assertNotebookInvariants(notebook: Notebook): void {
  assertUnique(notebook.roster.map(({ id }) => id), 'Roster player IDs');

  const activeMatches = notebook.matches.filter(({ finishedAt }) => finishedAt === null);
  if (activeMatches.length > 1) throw new Error('Only one match can be active');

  const matchIds: string[] = [];
  for (const match of notebook.matches) {
    matchIds.push(match.id);
    assertUnique(match.players.map(({ id }) => id), 'Match player IDs');
    assertUnique(match.players.map(({ number }) => String(Number(number))), 'Match player numbers');
    const playerIds = new Set(match.players.map(({ id }) => id));
    const actionIds: string[] = [];
    let openPeriodSeen = false;
    let allClosed = true;

    let activePeriodFound = false;
    match.periods.forEach((period) => {
      if (period.closed) {
        if (openPeriodSeen) throw new Error('Closed periods must be consecutive from the start');
      } else {
        allClosed = false;
        openPeriodSeen = true;
        if (activePeriodFound && period.actions.length > 0) {
          throw new Error('Only the current period may contain actions');
        }
        activePeriodFound = true;
      }

      for (const action of period.actions) {
        actionIds.push(action.id);
        if (action.kind === 'foul' && (action.team !== 'alm' || action.playerId === null)) {
          throw new Error('Fouls must be attributed to an ALM player');
        }
        if (action.kind === 'points') {
          if (action.team === 'alm' && action.playerId === null) {
            throw new Error('ALM points must be attributed to a player');
          }
          if (action.team === 'opponent' && action.playerId !== null) {
            throw new Error('Opponent points must be anonymous');
          }
        }
        if (action.playerId !== null && !playerIds.has(action.playerId)) {
          throw new Error('Action player must belong to the match');
        }
      }
    });

    assertUnique(actionIds, 'Action IDs');
    if (match.finishedAt !== null && !allClosed) {
      throw new Error('A finished match must have all periods closed');
    }
  }
  assertUnique(matchIds, 'Match IDs');
}

export function validateNotebook(value: unknown): value is Notebook {
  try {
    const notebook = notebookSchema.parse(value);
    assertNotebookInvariants(notebook);
    return true;
  } catch {
    return false;
  }
}

function parseNotebook(value: unknown): Notebook {
  const notebook = notebookSchema.parse(value);
  assertNotebookInvariants(notebook);
  return notebook;
}

function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createInitialNotebook(): Notebook {
  return {
    roster: Array.from({ length: 14 }, (_, index) => ({
      id: `player-${index + 1}`,
      name: `Joueur ${index + 1}`,
    })),
    trackFouls: false,
    teams: [],
    matches: [],
  };
}

export type Score = { alm: number; opponent: number };
export type PlayerStats = { points: number; fouls: number };

export function periodScore(period: Period): Score {
  return period.actions.reduce<Score>((score, action) => {
    if (action.kind === 'points') score[action.team] += action.value;
    return score;
  }, { alm: 0, opponent: 0 });
}

export function periodPoints(period: Period): Score {
  const score = periodScore(period);
  if (score.alm === score.opponent) return { alm: 2, opponent: 2 };
  return score.alm > score.opponent ? { alm: 3, opponent: 1 } : { alm: 1, opponent: 3 };
}

export function matchPoints(match: Match): Score {
  return match.periods.reduce<Score>((total, period) => {
    if (period.closed) {
      const points = periodPoints(period);
      total.alm += points.alm;
      total.opponent += points.opponent;
    }
    return total;
  }, { alm: 0, opponent: 0 });
}

export function playerStats(match: Match, playerId: string): PlayerStats {
  return match.periods.flatMap(({ actions }) => actions).reduce<PlayerStats>((stats, action) => {
    if (action.playerId === playerId) {
      if (action.kind === 'points') stats.points += action.value;
      else stats.fouls += 1;
    }
    return stats;
  }, { points: 0, fouls: 0 });
}

export function startMatch(
  notebook: Notebook,
  opponent: string,
  home: boolean,
  players: MatchPlayer[],
): Notebook {
  if (!validateNotebook(notebook)) throw new Error('Invalid notebook');
  if (activeMatch(notebook)) throw new Error('A match is already active');
  const cleanOpponent = opponent.trim();
  if (!cleanOpponent) throw new Error('Opponent name is required');
  if (players.length < 6 || players.length > 10) throw new Error('A match requires between 6 and 10 players');

  const rosterById = new Map(notebook.roster.map((player) => [player.id, player]));
  const selectedIds = new Set<string>();
  const cleanPlayers = players.map((player) => {
    const rosterPlayer = rosterById.get(player.id);
    if (!rosterPlayer || selectedIds.has(player.id) || player.name !== rosterPlayer.name) {
      throw new Error('Match players must be distinct players from the roster');
    }
    selectedIds.add(player.id);
    if (!isJerseyNumber(player.number)) {
      throw new Error('Player numbers must be between 1 and 999');
    }
    return { id: player.id, name: player.name, number: player.number };
  });
  assertUnique(cleanPlayers.map(({ number }) => String(Number(number))), 'Match player numbers');

  const match: Match = {
    id: newId(),
    opponent: cleanOpponent,
    home,
    players: cleanPlayers,
    periods: Array.from({ length: 8 }, () => ({ actions: [], closed: false })),
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  const result = { ...notebook, matches: [...notebook.matches, match] };
  if (!validateNotebook(result)) throw new Error('Could not create a valid match');
  return result;
}

export function addAction(match: Match, action: Action): Match {
  if (!validateMatch(match)) throw new Error('Invalid match');
  if (match.finishedAt !== null) throw new Error('The match is finished');
  const index = match.periods.findIndex(({ closed }) => !closed);
  if (index < 0) throw new Error('There is no open period');
  const parsedAction = actionSchema.parse(action);
  const playerIds = new Set(match.players.map(({ id }) => id));
  if (parsedAction.kind === 'foul' && (parsedAction.team !== 'alm' || parsedAction.playerId === null)) {
    throw new Error('Fouls must be attributed to an ALM player');
  }
  if (parsedAction.kind === 'points') {
    if (parsedAction.team === 'alm' && parsedAction.playerId === null) {
      throw new Error('ALM points must be attributed to a player');
    }
    if (parsedAction.team === 'opponent' && parsedAction.playerId !== null) {
      throw new Error('Opponent points must be anonymous');
    }
  }
  if (parsedAction.playerId !== null && !playerIds.has(parsedAction.playerId)) {
    throw new Error('Action player must belong to the match');
  }
  if (match.periods.some((period) => period.actions.some(({ id }) => id === parsedAction.id))) {
    throw new Error('Action ID must be unique');
  }
  const periods = match.periods.map((period, periodIndex) => periodIndex === index
    ? { ...period, actions: [...period.actions, parsedAction] }
    : period);
  return { ...match, periods };
}

function validateMatch(value: unknown): value is Match {
  try {
    const match = matchSchema.parse(value);
    const notebook: Notebook = {
      roster: createInitialNotebook().roster,
      trackFouls: false,
      teams: [],
      matches: [match],
    };
    assertNotebookInvariants(notebook);
    return true;
  } catch {
    return false;
  }
}

export function undoAction(match: Match): Match {
  if (!validateMatch(match)) throw new Error('Invalid match');
  if (match.finishedAt !== null) throw new Error('The match is finished');
  const index = match.periods.findIndex(({ closed }) => !closed);
  if (index < 0) throw new Error('There is no open period');
  const period = match.periods[index];
  if (period.actions.length === 0) throw new Error('There is no action to undo');
  const periods = match.periods.map((item, periodIndex) => periodIndex === index
    ? { ...item, actions: item.actions.slice(0, -1) }
    : item);
  return { ...match, periods };
}

export function closePeriod(match: Match): Match {
  if (!validateMatch(match)) throw new Error('Invalid match');
  if (match.finishedAt !== null) throw new Error('The match is already finished');
  const index = match.periods.findIndex(({ closed }) => !closed);
  if (index < 0) throw new Error('There is no open period');
  const periods = match.periods.map((period, periodIndex) => periodIndex === index
    ? { ...period, closed: true }
    : period);
  return { ...match, periods };
}

export function finishMatch(match: Match): Match {
  if (!validateMatch(match)) throw new Error('Invalid match');
  if (match.finishedAt !== null) throw new Error('The match is already finished');
  if (match.periods.some(({ closed }) => !closed)) throw new Error('All periods must be closed before finishing the match');
  return { ...match, finishedAt: new Date().toISOString() };
}

export function activeMatch(notebook: Notebook): Match | null {
  return notebook.matches.find(({ finishedAt }) => finishedAt === null) ?? null;
}

function migrateLegacyMatch(value: unknown): Match | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (validateMatch(candidate)) return candidate as unknown as Match;
  return null;
}

function migrateV1(value: Record<string, unknown>): Notebook {
  const nested = value.notebook ?? value.data ?? value.state;
  const raw = (nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested
    : value) as Record<string, unknown>;
  const initial = createInitialNotebook();
  if (!Array.isArray(raw.teams) || !Array.isArray(raw.matches)) throw new Error('Invalid legacy notebook');
  if (raw.roster !== undefined && (!Array.isArray(raw.roster) || raw.roster.length !== 14)) throw new Error('Invalid legacy roster');
  const roster = raw.roster ?? initial.roster;
  if (raw.teams !== undefined && !Array.isArray(raw.teams)) throw new Error('Invalid legacy teams');
  if (raw.matches !== undefined && !Array.isArray(raw.matches)) throw new Error('Invalid legacy matches');
  const teams = raw.teams ?? [];
  const matches = (raw.matches ?? []) as unknown[];
  const migratedMatches = matches.map((match) => {
    const migrated = migrateLegacyMatch(match);
    if (!migrated) throw new Error('Unsupported legacy match format; no data was imported');
    return migrated;
  });
  const notebook = {
    roster,
    trackFouls: typeof raw.trackFouls === 'boolean' ? raw.trackFouls : false,
    teams,
    matches: migratedMatches,
  };
  return parseNotebook(notebook);
}

export function parseBackup(value: unknown): Notebook {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Backup must be a JSON object');
  }
  const backup = value as Record<string, unknown>;
  if (backup.version === 2) {
    if (Object.keys(backup).some((key) => key !== 'version' && key !== 'notebook')) throw new Error('Invalid backup fields');
    return parseNotebook(backup.notebook);
  }
  if (backup.version === 1) {
    return migrateV1(backup);
  }
  throw new Error('Unsupported backup version');
}

export function makeBackup(notebook: Notebook): unknown {
  if (!validateNotebook(notebook)) throw new Error('Invalid notebook');
  return { version: 2, notebook: structuredClone(notebook) };
}
