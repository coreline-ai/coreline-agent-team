import { Box, Text } from 'ink'
import { Panel } from './layout.js'

export function HelpOverlay() {
  return (
    <Panel title="Help" borderColor="magenta">
      <Box flexDirection="column">
        <Text>Tab: switch Tasks / Teammates primary pane</Text>
        <Text>Up / Down: move selection</Text>
        <Text>Left / Right or [ ]: switch detail tab (Activity / Transcript / Logs)</Text>
        <Text>, / .: switch stdout / stderr when Logs is selected</Text>
        <Text>f: cycle focus mode (none -&gt; primary -&gt; detail)</Text>
        <Text>j / k: scroll detail pane newer / older</Text>
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
