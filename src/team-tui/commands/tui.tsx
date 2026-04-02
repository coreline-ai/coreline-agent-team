import React from 'react'
import { render, type RenderOptions } from 'ink'
import type { TeamCoreOptions } from '../../team-core/index.js'
import { TeamTuiApp } from '../app.js'

export type TuiCommandRenderOptions = {
  renderOptions?: RenderOptions
  exitOnRender?: boolean
}

export async function runTuiCommand(
  teamName: string | undefined,
  options: TeamCoreOptions = {},
  input: TuiCommandRenderOptions = {},
): Promise<number> {
  let exitCode = 0

  const instance = render(
    <TeamTuiApp
      initialTeamName={teamName}
      options={options}
      mode="control"
      exitOnRender={input.exitOnRender}
      onExit={code => {
        exitCode = code
      }}
    />,
    input.renderOptions,
  )

  await instance.waitUntilExit()
  return exitCode
}
