import { emptyData, saveTeam, setTrackFouls, startAlmMatch, startMatch, type AppData, type Side, type Team } from '../domain'

export const home: Team = {
  id: 'lynx', name: 'Les Lynx',
  players: [{ id: 'alice', name: 'Alice', number: '7' }, { id: 'charlie', name: 'Charlie', number: '10' }],
}
export const away: Team = {
  id: 'lions', name: 'Les Lions',
  players: [{ id: 'bob', name: 'Bob', number: '9' }],
}
export function withTeams(): AppData {
  return saveTeam(saveTeam(emptyData(), home), away)
}
export function withMatch(): AppData {
  return setTrackFouls(startMatch(withTeams(), home.id, away.id), true)
}

export function selection(data = emptyData()) {
  return data.almRoster.slice(0, 10).map((player, index) => ({ playerId: player.id, number: String(index + 4) }))
}

export function withAlmMatch(almSide: Side = 'home'): AppData {
  const data = emptyData()
  return startAlmMatch(data, 'Les Lions', selection(data), almSide)
}

export function legacyData() {
  const data = withMatch()
  return {
    teams: data.teams,
    matches: data.matches.map(({ almSide: _almSide, ...match }) => match),
  }
}
