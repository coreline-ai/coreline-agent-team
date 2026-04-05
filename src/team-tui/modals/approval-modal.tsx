import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useEffect, useState } from 'react'
import {
  describePermissionRequestContext,
  describeSuggestedPermissionRuleMatch,
  getAvailablePermissionRulePresets,
  permissionRulePresets,
  type PermissionRulePreset,
} from '../../team-core/index.js'
import type { DashboardApprovalItem } from '../../team-operator/index.js'
import { Panel } from '../components/layout.js'

const permissionPresetHotkeys: Array<{
  key: string
  preset: PermissionRulePreset
}> = [
  { key: '1', preset: 'suggested' },
  { key: '2', preset: 'command' },
  { key: '3', preset: 'cwd' },
  { key: '4', preset: 'path' },
  { key: '5', preset: 'host' },
]

export function ApprovalModal(props: {
  approvals: DashboardApprovalItem[]
  onCancel(): void
  onApprove(input: {
    approval: DashboardApprovalItem
    persistDecision: boolean
    rulePreset?: PermissionRulePreset
    ruleContent?: string
  }): Promise<void> | void
  onDeny(input: {
    approval: DashboardApprovalItem
    persistDecision: boolean
    rulePreset?: PermissionRulePreset
    ruleContent?: string
  }): Promise<void> | void
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [persistDecision, setPersistDecision] = useState(false)
  const [rulePreset, setRulePreset] = useState<PermissionRulePreset>('suggested')
  const [ruleContent, setRuleContent] = useState('')

  useEffect(() => {
    setSelectedIndex(previous =>
      Math.min(previous, Math.max(props.approvals.length - 1, 0)),
    )
  }, [props.approvals.length])

  const selectedApproval = props.approvals[selectedIndex]
  const selectedPermissionAvailablePresets =
    selectedApproval?.kind === 'permission'
      ? getAvailablePermissionRulePresets(selectedApproval.request.input)
      : []
  const selectedPermissionContext =
    selectedApproval?.kind === 'permission'
      ? describePermissionRequestContext(selectedApproval.request.input)
      : []
  const selectedPermissionSuggestions =
    selectedApproval?.kind === 'permission'
      ? describeSuggestedPermissionRuleMatch(selectedApproval.request.input)
      : []

  useEffect(() => {
    if (selectedApproval?.kind !== 'permission') {
      return
    }

    setRulePreset(previous =>
      selectedPermissionAvailablePresets.includes(previous)
        ? previous
        : (selectedPermissionAvailablePresets[0] ?? 'suggested'),
    )
  }, [
    selectedApproval?.id,
    selectedApproval?.kind,
    selectedPermissionAvailablePresets.join(','),
  ])

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
    if (selectedApproval?.kind === 'permission' && key.leftArrow) {
      if (selectedPermissionAvailablePresets.length === 0) {
        return
      }
      setRulePreset(previous => {
        const currentIndex = selectedPermissionAvailablePresets.indexOf(previous)
        const nextIndex =
          currentIndex <= 0
            ? selectedPermissionAvailablePresets.length - 1
            : currentIndex - 1
        return selectedPermissionAvailablePresets[nextIndex] ?? previous
      })
      return
    }
    if (selectedApproval?.kind === 'permission' && key.rightArrow) {
      if (selectedPermissionAvailablePresets.length === 0) {
        return
      }
      setRulePreset(previous => {
        const currentIndex = selectedPermissionAvailablePresets.indexOf(previous)
        const nextIndex =
          currentIndex === -1 ||
          currentIndex >= selectedPermissionAvailablePresets.length - 1
            ? 0
            : currentIndex + 1
        return selectedPermissionAvailablePresets[nextIndex] ?? previous
      })
      return
    }
    if (selectedApproval?.kind === 'permission') {
      const hotkeyPreset = permissionPresetHotkeys.find(item => item.key === input)
      if (
        hotkeyPreset &&
        selectedPermissionAvailablePresets.includes(hotkeyPreset.preset)
      ) {
        setRulePreset(hotkeyPreset.preset)
        return
      }
    }
    if (key.return && selectedApproval) {
      void props.onApprove({
        approval: selectedApproval,
        persistDecision,
        rulePreset:
          selectedApproval.kind === 'permission' &&
          selectedPermissionAvailablePresets.includes(rulePreset)
            ? rulePreset
            : undefined,
        ruleContent: ruleContent.trim() || undefined,
      })
      return
    }
    if (input === 'd' && selectedApproval) {
      void props.onDeny({
        approval: selectedApproval,
        persistDecision,
        rulePreset:
          selectedApproval.kind === 'permission' &&
          selectedPermissionAvailablePresets.includes(rulePreset)
            ? rulePreset
            : undefined,
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
            <Text color="gray">Selected request details:</Text>
            {selectedPermissionContext.length > 0 ? (
              selectedPermissionContext.map(line => (
                <Text key={line} color="gray">
                  - {line}
                </Text>
              ))
            ) : (
              <Text color="gray">- no structured cmd/cwd/path/host context</Text>
            )}
            {selectedPermissionSuggestions.length > 0 ? (
              <>
                <Text color="gray">Suggested persistence:</Text>
                {selectedPermissionSuggestions.map(line => (
                  <Text key={line} color="gray">
                    - {line}
                  </Text>
                ))}
              </>
            ) : null}
            <Text>Persist rule: {persistDecision ? 'yes' : 'no'} (press p)</Text>
            <Text>
              Preset:{' '}
              {selectedPermissionAvailablePresets.includes(rulePreset)
                ? rulePreset
                : 'n/a'}{' '}
              (1-5 or ←/→)
            </Text>
            <Text color="gray">
              Available presets:{' '}
              {permissionRulePresets
                .filter(preset => selectedPermissionAvailablePresets.includes(preset))
                .join(', ') || 'none'}
            </Text>
            {persistDecision ? (
              <Box>
                <Text>Rule text: </Text>
                <TextInput value={ruleContent} onChange={setRuleContent} />
              </Box>
            ) : (
              <Text color="gray">Rule text input unlocks after persist is on.</Text>
            )}
          </Box>
        ) : selectedApproval?.kind === 'sandbox' ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="gray">Selected request details:</Text>
            <Text color="gray">- host={selectedApproval.host}</Text>
          </Box>
        ) : selectedApproval?.kind === 'plan' ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="gray">Selected request details:</Text>
            <Text color="gray">- plan={selectedApproval.planFilePath}</Text>
          </Box>
        ) : null}
      </Box>
    </Panel>
  )
}
