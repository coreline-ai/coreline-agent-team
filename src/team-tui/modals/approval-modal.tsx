import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useEffect, useState } from 'react'
import type { DashboardApprovalItem } from '../../team-operator/index.js'
import { Panel } from '../components/layout.js'

export function ApprovalModal(props: {
  approvals: DashboardApprovalItem[]
  onCancel(): void
  onApprove(input: {
    approval: DashboardApprovalItem
    persistDecision: boolean
    ruleContent?: string
  }): Promise<void> | void
  onDeny(input: {
    approval: DashboardApprovalItem
    persistDecision: boolean
    ruleContent?: string
  }): Promise<void> | void
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [persistDecision, setPersistDecision] = useState(false)
  const [ruleContent, setRuleContent] = useState('')

  useEffect(() => {
    setSelectedIndex(previous =>
      Math.min(previous, Math.max(props.approvals.length - 1, 0)),
    )
  }, [props.approvals.length])

  const selectedApproval = props.approvals[selectedIndex]

  useInput((input, key) => {
    if (key.escape) {
      props.onCancel()
      return
    }
    if (key.upArrow) {
      setSelectedIndex(previous => Math.max(previous - 1, 0))
      return
    }
    if (key.downArrow) {
      setSelectedIndex(previous =>
        Math.min(previous + 1, Math.max(props.approvals.length - 1, 0)),
      )
      return
    }
    if (input === 'p' && selectedApproval?.kind === 'permission') {
      setPersistDecision(previous => !previous)
      return
    }
    if (key.return && selectedApproval) {
      void props.onApprove({
        approval: selectedApproval,
        persistDecision,
        ruleContent: ruleContent.trim() || undefined,
      })
      return
    }
    if (input === 'd' && selectedApproval) {
      void props.onDeny({
        approval: selectedApproval,
        persistDecision,
        ruleContent: ruleContent.trim() || undefined,
      })
    }
  })

  return (
    <Panel title="Approval Inbox" borderColor="yellow">
      <Box flexDirection="column">
        <Text color="gray">Up/Down select, Enter approve, d deny, Esc close.</Text>
        {props.approvals.length === 0 ? (
          <Text>No pending approvals.</Text>
        ) : (
          props.approvals.map((approval, index) => (
            <Text
              key={approval.id}
              color={selectedIndex === index ? 'green' : undefined}
            >
              {selectedIndex === index ? '> ' : '  '}
              [{approval.kind}] {approval.workerName}
              {approval.kind === 'permission'
                ? ` ${approval.toolName}: ${approval.description}`
                : approval.kind === 'sandbox'
                  ? ` host=${approval.host}`
                  : ` ${approval.planFilePath}`}
            </Text>
          ))
        )}
        {selectedApproval?.kind === 'permission' ? (
          <Box flexDirection="column" marginTop={1}>
            <Text>Persist rule: {persistDecision ? 'yes' : 'no'} (press p)</Text>
            <Box>
              <Text>Rule text: </Text>
              <TextInput value={ruleContent} onChange={setRuleContent} />
            </Box>
          </Box>
        ) : null}
      </Box>
    </Panel>
  )
}
