import React from 'react'
import { render, type RenderOptions } from 'ink'
import type { TeamCoreOptions, TeamRuntimeKind } from '../../team-core/index.js'
import { ProjectStudioApp, type ProjectStudioAppDependencies } from '../project-builder-app.js'

export type AppCommandInput = {
  teamName?: string
  workspace?: string
  runtimeKind?: TeamRuntimeKind
  model?: string
  codexExecutablePath?: string
  upstreamExecutablePath?: string
}

export type AppCommandRenderOptions = {
  renderOptions?: RenderOptions
  exitOnRender?: boolean
  dependencies?: Partial<ProjectStudioAppDependencies>
}

export async function runAppCommand(
  input: AppCommandInput = {},
  options: TeamCoreOptions = {},
  renderInput: AppCommandRenderOptions = {},
): Promise<number> {
  let exitCode = 0

  const instance = render(
    <ProjectStudioApp
      options={options}
      teamName={input.teamName}
      workspace={input.workspace}
      runtimeKind={input.runtimeKind}
      model={input.model}
      codexExecutablePath={input.codexExecutablePath}
      upstreamExecutablePath={input.upstreamExecutablePath}
      exitOnRender={renderInput.exitOnRender}
      dependencies={renderInput.dependencies}
      onExit={code => {
        exitCode = code
      }}
    />,
    renderInput.renderOptions,
  )

  await instance.waitUntilExit()
  return exitCode
}
