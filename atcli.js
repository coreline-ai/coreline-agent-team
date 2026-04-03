#!/usr/bin/env bun

async function resolveModules() {
  try {
    const [cliModule, helperModule] = await Promise.all([
      import('./dist/src/team-cli/run-cli.js'),
      import('./dist/src/atcli/forwarded-args.js'),
    ])
    return {
      runCli: cliModule.runCli,
      buildAtcliForwardedArgs: helperModule.buildAtcliForwardedArgs,
    }
  } catch (distError) {
    if (typeof Bun !== 'undefined') {
      const [cliModule, helperModule] = await Promise.all([
        import('./src/team-cli/run-cli.ts'),
        import('./src/atcli/forwarded-args.ts'),
      ])
      return {
        runCli: cliModule.runCli,
        buildAtcliForwardedArgs: helperModule.buildAtcliForwardedArgs,
      }
    }

    const errorMessage = distError instanceof Error ? distError.message : String(distError)
    console.error('Failed to load built CLI. Run `npm run build` first or execute with Bun once dependencies are installed.')
    console.error(errorMessage)
    process.exit(1)
  }
}

const { runCli, buildAtcliForwardedArgs } = await resolveModules()
const exitCode = await runCli(buildAtcliForwardedArgs(process.argv.slice(2)))
process.exitCode = exitCode
