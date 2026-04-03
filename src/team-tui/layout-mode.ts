import type { TeamTuiLayoutMode } from './types.js'

export function getTeamTuiLayoutMode(columns: number): TeamTuiLayoutMode {
  if (columns < 100) {
    return 'narrow'
  }
  if (columns < 150) {
    return 'compact'
  }
  return 'wide'
}
