import { Box, Text } from 'ink'
import type { PropsWithChildren } from 'react'

export function Panel(
  props: PropsWithChildren<{
    title: string
    width?: number | string
    minHeight?: number
    borderColor?: string
  }>,
) {
  return (
    <Box
      borderStyle="round"
      borderColor={props.borderColor ?? 'cyan'}
      flexDirection="column"
      paddingX={1}
      width={props.width}
      minHeight={props.minHeight}
    >
      <Text color={props.borderColor ?? 'cyan'}>{props.title}</Text>
      <Box marginTop={1} flexDirection="column">
        {props.children}
      </Box>
    </Box>
  )
}

export function KeyHint(props: { label: string; active?: boolean }) {
  return (
    <Text color={props.active ? 'green' : 'gray'}>
      {props.label}
    </Text>
  )
}

export function TabLabel(props: {
  label: string
  active?: boolean
}) {
  return (
    <Text color={props.active ? 'green' : 'gray'}>
      {props.active ? `[${props.label}]` : props.label}
    </Text>
  )
}
