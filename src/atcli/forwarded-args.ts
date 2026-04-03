export function buildAtcliForwardedArgs(args: string[]): string[] {
  const globalArgs: string[] = []
  let index = 0

  while (index < args.length) {
    const token = args[index]
    if (token === '--root-dir') {
      const value = args[index + 1]
      if (value) {
        globalArgs.push(token, value)
        index += 2
        continue
      }
    }
    break
  }

  const remaining = args.slice(index)
  const first = remaining[0]
  if (first && ['help', '--help', '-h'].includes(first)) {
    return ['help']
  }

  return [...globalArgs, 'app', ...remaining]
}
