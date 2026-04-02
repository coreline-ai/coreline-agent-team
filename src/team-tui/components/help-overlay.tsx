import { Box, Text } from 'ink'
import { Panel } from './layout.js'

export function HelpOverlay() {
  return (
    <Panel title="Help" borderColor="magenta">
      <Box flexDirection="column">
        <Text>Tab / arrow: move selection</Text>
        <Text>Enter: open selected team in picker</Text>
        <Text>s: spawn teammate</Text>
        <Text>t: create task</Text>
        <Text>m: send leader message</Text>
        <Text>a: open approval inbox</Text>
        <Text>u: resume selected teammate</Text>
        <Text>x: send shutdown request to selected teammate</Text>
        <Text>r: refresh</Text>
        <Text>q or Esc: close / quit</Text>
      </Box>
    </Panel>
  )
}
