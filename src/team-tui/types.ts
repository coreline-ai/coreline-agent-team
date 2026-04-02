import type { TeamCoreOptions } from '../team-core/index.js'

export type TeamTuiMode = 'control' | 'watch'

export type TuiPane = 'tasks' | 'teammates' | 'activity'

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
  exitOnRender?: boolean
  onExit?: (exitCode: number) => void
}
