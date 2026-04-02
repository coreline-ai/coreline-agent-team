import React from 'react'
import { render, type RenderOptions } from 'ink'
import type { TeamCoreOptions } from '../../team-core/index.js'
import { TeamTuiApp } from '../app.js'

export type WatchCommandRenderOptions = {
  renderOptions?: RenderOptions
  exitOnRender?: boolean
}

export async function runWatchCommand(
  teamName: string,
  options: TeamCoreOptions = {},
  input: WatchCommandRenderOptions = {},
): Promise<number> {
  let exitCode = 0

  const instance = render(
    <TeamTuiApp
      initialTeamName={teamName}
      options={options}
      mode="watch"
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
