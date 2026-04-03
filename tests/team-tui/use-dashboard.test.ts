import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDashboardLoadLifecycle,
  loadDashboardSafely,
} from '../../src/team-tui/hooks/use-dashboard.js'

function createDeferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void
  let rejectPromise!: (reason?: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve(value: T | PromiseLike<T>) {
      resolvePromise(value)
    },
    reject(reason?: unknown) {
      rejectPromise(reason)
    },
  }
}

test('loadDashboardSafely ignores completion updates after the lifecycle is disposed', async () => {
  const lifecycle = createDashboardLoadLifecycle()
  const deferred = createDeferred<null>()
  const events: string[] = []

  const pendingLoad = loadDashboardSafely({
    lifecycle,
    teamName: 'alpha-team',
    options: {
      rootDir: '/tmp/agent-team-dashboard-dispose',
    },
    loadDashboardImpl: async () => deferred.promise,
    applyDashboard(nextDashboard) {
      events.push(`dashboard:${nextDashboard === null ? 'null' : 'value'}`)
    },
    applyLoading(nextIsLoading) {
      events.push(`loading:${String(nextIsLoading)}`)
    },
    applyError(nextError) {
      events.push(`error:${nextError ?? 'undefined'}`)
    },
  })

  assert.deepEqual(events, ['loading:true'])

  lifecycle.dispose()
  deferred.resolve(null)
  await pendingLoad

  assert.deepEqual(events, ['loading:true'])
})

test('loadDashboardSafely keeps the newest request authoritative when older work finishes later', async () => {
  const lifecycle = createDashboardLoadLifecycle()
  const firstRequest = createDeferred<null>()
  const secondRequest = createDeferred<null>()
  const events: string[] = []
  let loadCount = 0

  const loadDashboardImpl = async () => {
    loadCount += 1
    return loadCount === 1
      ? firstRequest.promise
      : secondRequest.promise
  }

  const firstLoad = loadDashboardSafely({
    lifecycle,
    teamName: 'alpha-team',
    options: {
      rootDir: '/tmp/agent-team-dashboard-stale',
    },
    loadDashboardImpl,
    applyDashboard(nextDashboard) {
      events.push(`dashboard:${nextDashboard === null ? 'null' : 'value'}`)
    },
    applyLoading(nextIsLoading) {
      events.push(`loading:${String(nextIsLoading)}`)
    },
    applyError(nextError) {
      events.push(`error:${nextError ?? 'undefined'}`)
    },
  })

  const secondLoad = loadDashboardSafely({
    lifecycle,
    teamName: 'alpha-team',
    options: {
      rootDir: '/tmp/agent-team-dashboard-stale',
    },
    loadDashboardImpl,
    applyDashboard(nextDashboard) {
      events.push(`dashboard:${nextDashboard === null ? 'null' : 'value'}`)
    },
    applyLoading(nextIsLoading) {
      events.push(`loading:${String(nextIsLoading)}`)
    },
    applyError(nextError) {
      events.push(`error:${nextError ?? 'undefined'}`)
    },
  })

  assert.deepEqual(events, ['loading:true', 'loading:true'])

  secondRequest.resolve(null)
  await secondLoad

  assert.deepEqual(events, [
    'loading:true',
    'loading:true',
    'dashboard:null',
    'error:undefined',
    'loading:false',
  ])

  firstRequest.reject(new Error('stale request should be ignored'))
  await firstLoad

  assert.deepEqual(events, [
    'loading:true',
    'loading:true',
    'dashboard:null',
    'error:undefined',
    'loading:false',
  ])
})
