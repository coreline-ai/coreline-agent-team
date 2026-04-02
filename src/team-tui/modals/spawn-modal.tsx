import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useState } from 'react'
import { Panel } from '../components/layout.js'
import type { SpawnTeammateOperatorInput } from '../../team-operator/index.js'

type SpawnModalValues = Pick<
  SpawnTeammateOperatorInput,
  'agentName' | 'prompt' | 'runtimeKind' | 'model'
>

export function SpawnModal(props: {
  initialAgentName?: string
  onCancel(): void
  onSubmit(input: SpawnModalValues): Promise<void> | void
}) {
  const [agentName, setAgentName] = useState(props.initialAgentName ?? '')
  const [prompt, setPrompt] = useState('Help with the current task list')
  const [runtimeKind, setRuntimeKind] = useState<'local' | 'codex-cli' | 'upstream'>('codex-cli')
  const [model, setModel] = useState('gpt-5.4-mini')
  const [fieldIndex, setFieldIndex] = useState(0)

  useInput((_input, key) => {
    if (key.escape) {
      props.onCancel()
    }
    if (key.tab) {
      setFieldIndex(previous => (previous + 1) % 4)
    }
  })

  const fields = [
    {
      label: 'Agent',
      value: agentName,
      onChange: setAgentName,
    },
    {
      label: 'Prompt',
      value: prompt,
      onChange: setPrompt,
    },
    {
      label: 'Runtime',
      value: runtimeKind,
      onChange: (value: string) => {
        if (value === 'local' || value === 'codex-cli' || value === 'upstream') {
          setRuntimeKind(value)
        }
      },
    },
    {
      label: 'Model',
      value: model,
      onChange: setModel,
    },
  ] as const

  return (
    <Panel title="Spawn Teammate" borderColor="yellow">
      <Box flexDirection="column">
        <Text color="gray">Tab to switch fields, Enter on Model to submit, Esc to cancel.</Text>
        {fields.map((field, index) => (
          <Box key={field.label}>
            <Text color={fieldIndex === index ? 'green' : 'gray'}>{field.label}: </Text>
            {fieldIndex === index ? (
              <TextInput
                value={field.value}
                onChange={field.onChange}
                onSubmit={async () => {
                  if (index < fields.length - 1) {
                    setFieldIndex(index + 1)
                    return
                  }

                  await props.onSubmit({
                    agentName: agentName.trim(),
                    prompt: prompt.trim(),
                    runtimeKind,
                    model: model.trim(),
                  })
                }}
              />
            ) : (
              <Text>{field.value}</Text>
            )}
          </Box>
        ))}
      </Box>
    </Panel>
  )
}
