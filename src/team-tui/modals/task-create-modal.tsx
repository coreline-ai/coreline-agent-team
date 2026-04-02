import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useState } from 'react'
import { Panel } from '../components/layout.js'

export function TaskCreateModal(props: {
  onCancel(): void
  onSubmit(input: { subject: string; description: string }): Promise<void> | void
}) {
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [fieldIndex, setFieldIndex] = useState(0)

  useInput((_input, key) => {
    if (key.escape) {
      props.onCancel()
    }
    if (key.tab) {
      setFieldIndex(previous => (previous + 1) % 2)
    }
  })

  return (
    <Panel title="Create Task" borderColor="yellow">
      <Box flexDirection="column">
        <Text color="gray">Tab to switch fields, Enter on Description to submit.</Text>
        <Box>
          <Text color={fieldIndex === 0 ? 'green' : 'gray'}>Subject: </Text>
          {fieldIndex === 0 ? (
            <TextInput
              value={subject}
              onChange={setSubject}
              onSubmit={() => {
                setFieldIndex(1)
              }}
            />
          ) : (
            <Text>{subject}</Text>
          )}
        </Box>
        <Box>
          <Text color={fieldIndex === 1 ? 'green' : 'gray'}>Description: </Text>
          {fieldIndex === 1 ? (
            <TextInput
              value={description}
              onChange={setDescription}
              onSubmit={async () => {
                await props.onSubmit({
                  subject: subject.trim(),
                  description: description.trim(),
                })
              }}
            />
          ) : (
            <Text>{description}</Text>
          )}
        </Box>
      </Box>
    </Panel>
  )
}
