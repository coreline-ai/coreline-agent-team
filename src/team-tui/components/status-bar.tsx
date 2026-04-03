import { Box, Text } from 'ink'
import { formatDisplayPath } from '../../team-core/index.js'
import { KeyHint } from './layout.js'

export function StatusBar(props: {
  readOnly: boolean
  pendingApprovals: number
  rootDir?: string
  currentTeamName?: string
  focusMode?: 'none' | 'primary' | 'detail'
  toastMessage?: string
  error?: string
  actionInFlight?: boolean
}) {
  return (
    <Box flexDirection="column">
      <Text>
        Team: {props.currentTeamName ?? 'select a team'}  Root: {formatDisplayPath(props.rootDir) ?? '~/.agent-team'}  Pending approvals: {props.pendingApprovals}  Focus: {props.focusMode ?? 'none'}
      </Text>
      <Box>
        {props.readOnly ? (
          <>
            <KeyHint label="tab switch" />
            <Text>  </Text>
            <KeyHint label="f focus" />
            <Text>  </Text>
            <KeyHint label="j/k scroll" />
            <Text>  </Text>
            <KeyHint label="r refresh" />
            <Text>  </Text>
            <KeyHint label="? help" />
            <Text>  </Text>
            <KeyHint label="q quit" />
          </>
        ) : (
          <>
            <KeyHint label="s spawn" />
            <Text>  </Text>
            <KeyHint label="t task" />
            <Text>  </Text>
            <KeyHint label="m message" />
            <Text>  </Text>
            <KeyHint label="a approvals" active={props.pendingApprovals > 0} />
            <Text>  </Text>
            <KeyHint label="u resume" />
            <Text>  </Text>
            <KeyHint label="x shutdown" />
            <Text>  </Text>
            <KeyHint label="f focus" />
            <Text>  </Text>
            <KeyHint label="j/k scroll" />
            <Text>  </Text>
            <KeyHint label="r refresh" />
            <Text>  </Text>
            <KeyHint label="? help" />
            <Text>  </Text>
            <KeyHint label="q quit" />
          </>
        )}
      </Box>
      {props.actionInFlight ? (
        <Text color="yellow">Applying action...</Text>
      ) : props.error ? (
        <Text color="red">Error: {props.error}</Text>
      ) : props.toastMessage ? (
        <Text color="green">{props.toastMessage}</Text>
      ) : null}
    </Box>
  )
}
