import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { CliCommandResult } from '../types.js'

export type DoctorCommandInput = {
  workspace?: string
  probe?: boolean
  codexExecutablePath?: string
}

type CommandExecutionResult = {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

type DoctorCheckStatus = 'ok' | 'fail' | 'skip'

type DoctorCheckResult = {
  label: string
  status: DoctorCheckStatus
  detail: string
  recommendation?: string
}

async function runCommand(
  command: string,
  args: string[],
  input: {
    cwd?: string
    stdinText?: string
    timeoutMs?: number
  } = {},
): Promise<CommandExecutionResult> {
  const child = spawn(command, args, {
    cwd: input.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  })

  let stdout = ''
  let stderr = ''
  let timedOut = false

  child.stdout.on('data', chunk => {
    stdout += String(chunk)
  })
  child.stderr.on('data', chunk => {
    stderr += String(chunk)
  })

  if (input.stdinText !== undefined) {
    child.stdin.write(input.stdinText)
  }
  child.stdin.end()

  const timeoutMs = input.timeoutMs ?? 15_000
  const exitCode = await new Promise<number>(resolvePromise => {
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.once('error', () => {
      clearTimeout(timeout)
      resolvePromise(127)
    })
    child.once('close', code => {
      clearTimeout(timeout)
      resolvePromise(code ?? 1)
    })
  })

  return {
    ok: exitCode === 0 && !timedOut,
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    timedOut,
  }
}

function formatCheck(result: DoctorCheckResult): string {
  const prefix =
    result.status === 'ok'
      ? 'OK'
      : result.status === 'skip'
        ? 'SKIP'
        : 'FAIL'

  const lines = [`- ${result.label}: ${prefix} - ${result.detail}`]
  if (result.recommendation) {
    lines.push(`  fix: ${result.recommendation}`)
  }
  return lines.join('\n')
}

async function checkCodexExecutable(
  executablePath: string,
): Promise<DoctorCheckResult> {
  const result = await runCommand(executablePath, ['--version'])
  if (!result.ok) {
    return {
      label: 'Codex CLI executable',
      status: 'fail',
      detail:
        result.stderr ||
        result.stdout ||
        (result.timedOut
          ? 'timed out while checking codex --version'
          : `failed with exit code ${result.exitCode}`),
      recommendation:
        'Codex CLI를 설치하거나 --codex-executable <path> 로 실행 파일 경로를 지정하세요.',
    }
  }

  return {
    label: 'Codex CLI executable',
    status: 'ok',
    detail: result.stdout || result.stderr || executablePath,
  }
}

async function checkCodexLogin(
  executablePath: string,
): Promise<DoctorCheckResult> {
  const result = await runCommand(executablePath, ['login', 'status'])
  if (!result.ok) {
    return {
      label: 'Codex CLI login',
      status: 'fail',
      detail:
        result.stderr ||
        result.stdout ||
        (result.timedOut
          ? 'timed out while checking codex login status'
          : `failed with exit code ${result.exitCode}`),
      recommendation: 'Codex CLI에서 로그인 상태를 확인하고 필요하면 `codex login` 을 실행하세요.',
    }
  }

  return {
    label: 'Codex CLI login',
    status: 'ok',
    detail: result.stdout || result.stderr || 'logged in',
  }
}

async function checkWorkspaceWrite(
  workspacePath: string,
): Promise<DoctorCheckResult> {
  const resolvedPath = resolve(workspacePath)
  const probeFile = join(
    resolvedPath,
    `.agent-team-doctor-${Date.now().toString(36)}.tmp`,
  )

  try {
    await mkdir(resolvedPath, { recursive: true })
    await writeFile(probeFile, 'ok\n', 'utf8')
    await rm(probeFile, { force: true })
    return {
      label: 'Workspace write access',
      status: 'ok',
      detail: resolvedPath,
    }
  } catch (error) {
    return {
      label: 'Workspace write access',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
      recommendation:
        'workspace 경로가 존재하고 현재 사용자에게 쓰기 권한이 있는지 확인하세요.',
    }
  }
}

async function runCodexProbe(
  executablePath: string,
  workspacePath: string,
): Promise<DoctorCheckResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'agent-team-doctor-'))
  const outputPath = join(tempDir, 'last-message.txt')

  try {
    const result = await runCommand(
      executablePath,
      [
        'exec',
        '-',
        '--color',
        'never',
        '--skip-git-repo-check',
        '--ephemeral',
        '--full-auto',
        '-C',
        resolve(workspacePath),
        '-o',
        outputPath,
      ],
      {
        cwd: workspacePath,
        stdinText:
          'Reply with exactly READY. Do not explain. Do not run unnecessary commands.',
        timeoutMs: 90_000,
      },
    )

    let probeText = result.stdout
    try {
      probeText = (await readFile(outputPath, 'utf8')).trim() || probeText
    } catch {
      // ignore and fall back to stdout/stderr
    }

    if (!result.ok || !/\bREADY\b/i.test(probeText)) {
      return {
        label: 'Codex exec probe',
        status: 'fail',
        detail:
          probeText ||
          result.stderr ||
          (result.timedOut
            ? 'timed out while running a real Codex turn'
            : `failed with exit code ${result.exitCode}`),
        recommendation:
          'Codex CLI가 실제 exec turn 을 수행할 수 있는지 확인하고, 로그인/권한/환경 설정을 다시 점검하세요.',
      }
    }

    return {
      label: 'Codex exec probe',
      status: 'ok',
      detail: probeText,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function runDoctorCommand(
  input: DoctorCommandInput = {},
): Promise<CliCommandResult> {
  const executablePath = input.codexExecutablePath ?? 'codex'
  const workspacePath = resolve(input.workspace ?? process.cwd())
  const checks: DoctorCheckResult[] = []

  const executableCheck = await checkCodexExecutable(executablePath)
  checks.push(executableCheck)

  if (executableCheck.status === 'ok') {
    checks.push(await checkCodexLogin(executablePath))
    checks.push(await checkWorkspaceWrite(workspacePath))

    if (input.probe) {
      checks.push(await runCodexProbe(executablePath, workspacePath))
    } else {
      checks.push({
        label: 'Codex exec probe',
        status: 'skip',
        detail: 'pass --probe to verify a real Codex turn before first use',
      })
    }
  } else {
    checks.push({
      label: 'Codex CLI login',
      status: 'skip',
      detail: 'skipped because executable check failed',
    })
    checks.push(await checkWorkspaceWrite(workspacePath))
    checks.push({
      label: 'Codex exec probe',
      status: 'skip',
      detail: 'skipped because executable check failed',
    })
  }

  const failedChecks = checks.filter(check => check.status === 'fail')
  const success = failedChecks.length === 0

  return {
    success,
    message: [
      'agent-team doctor',
      `workspace=${workspacePath}`,
      `codex=${executablePath}`,
      '',
      ...checks.map(formatCheck),
      '',
      `Result: ${success ? 'READY' : 'NOT READY'}`,
      ...(success
        ? [
            'Next steps:',
            '- agent-team run "<goal>" --workspace <path> --runtime codex-cli',
            '- agent-team watch <team>',
            '- agent-team tui <team>',
          ]
        : [
            'Resolve the failed checks above, then run `agent-team doctor --probe` again.',
          ]),
    ].join('\n'),
  }
}
