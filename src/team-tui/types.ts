import type { TeamCoreOptions } from '../team-core/index.js'

export type TeamTuiMode = 'control' | 'watch'

export type TeamTuiLayoutMode = 'wide' | 'compact' | 'narrow'

export type TuiPane = 'tasks' | 'teammates'

export type TuiDetailTab = 'activity' | 'transcript' | 'logs'

export type TuiLogStream = 'stderr' | 'stdout'

export type TuiFocusMode = 'none' | 'primary' | 'detail'

export type TuiModalState =
  | {
      kind: 'none'
    }
  | {
      kind: 'spawn'
    }
  | {
      kind: 'task-create'
    }
  | {
      kind: 'send-message'
    }
  | {
      kind: 'approvals'
    }

export type TeamTuiAppProps = {
  initialTeamName?: string
  options?: TeamCoreOptions
  mode?: TeamTuiMode
  viewport?: {
    columns: number
    rows: number
  }
  exitOnRender?: boolean
  onExit?: (exitCode: number) => void
}
