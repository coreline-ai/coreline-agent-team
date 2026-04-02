import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useState } from 'react'
import { Panel } from '../components/layout.js'

export function SendMessageModal(props: {
  initialRecipient?: string
  onCancel(): void
  onSubmit(input: { recipient: string; message: string }): Promise<void> | void
}) {
  const [recipient, setRecipient] = useState(props.initialRecipient ?? '')
  const [message, setMessage] = useState('')
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
    <Panel title="Send Message" borderColor="yellow">
      <Box flexDirection="column">
        <Text color="gray">Tab to switch fields, Enter on Message to submit.</Text>
        <Box>
          <Text color={fieldIndex === 0 ? 'green' : 'gray'}>Recipient: </Text>
          {fieldIndex === 0 ? (
            <TextInput
              value={recipient}
              onChange={setRecipient}
              onSubmit={() => {
                setFieldIndex(1)
              }}
            />
          ) : (
            <Text>{recipient}</Text>
          )}
        </Box>
        <Box>
          <Text color={fieldIndex === 1 ? 'green' : 'gray'}>Message: </Text>
          {fieldIndex === 1 ? (
            <TextInput
              value={message}
              onChange={setMessage}
              onSubmit={async () => {
                await props.onSubmit({
                  recipient: recipient.trim(),
                  message: message.trim(),
                })
              }}
            />
          ) : (
            <Text>{message}</Text>
          )}
        </Box>
      </Box>
    </Panel>
  )
}
