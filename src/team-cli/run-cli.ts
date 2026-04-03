import { parseGlobalOptions, renderHelp } from './arg-parsers.js'
import { getCliCommandHandler } from './command-registry.js'

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const parsedGlobals = parseGlobalOptions(argv)
  if (parsedGlobals.error) {
    console.error(parsedGlobals.error)
    return 1
  }

  const options = parsedGlobals.options
  const [command, ...rest] = parsedGlobals.args

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(renderHelp())
    return 0
  }

  const commandHandler = getCliCommandHandler(command)
  if (!commandHandler) {
    console.error(`Unknown command: ${command}`)
    return 1
  }

  return commandHandler(rest, options)
}
