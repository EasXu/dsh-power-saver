import test from 'node:test'
import assert from 'node:assert/strict'

import { __test } from '../index.js'

const { createEngine, normalizeSettings, validatePatch, insideWindow } = __test

const BASE = Object.freeze({
  enabled: true,
  action: 'none',
  idleMinutes: 0,
  countdownSeconds: 5,
  windowStart: '',
  windowEnd: '',
  countJobs: true,
})

const clockAt = (hour, minute) => new Date(2026, 0, 1, hour, minute, 0).getTime()

/** Build an engine with a fake clock and fake DSH services. */
function setup(settings = BASE) {
  const state = { agents: [], jobs: [], clock: clockAt(12, 0), saved: { ...settings } }
  const listeners = new Map()
  const ctx = {
    get(name) {
      if (name === 'agents') return { list: () => state.agents }
      if (name === 'jobs') return { list: () => state.jobs }
      return undefined
    },
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
    effect(fn) {
      return fn()
    },
    logger: { info() {} },
    webServer: { register() { return () => {} } },
  }
  const engine = createEngine(ctx, {
    now: () => state.clock,
    loadSettings: () => state.saved,
    saveSettings: next => { state.saved = next },
    log: () => {},
  }).start()
  const emit = (name, payload) => listeners.get(name)?.(payload)
  return {
    engine,
    state,
    startWork() {
      state.agents.push({ id: 'a1', status: 'running' })
      emit('agent/status', { agent: { id: 'a1' }, status: 'running' })
    },
    stopWork() {
      if (state.agents[0] !== undefined) state.agents[0].status = 'idle'
      emit('agent/status', { agent: { id: 'a1' }, status: 'idle' })
    },
    advance(milliseconds) {
      state.clock += milliseconds
    },
  }
}

test('normalizeSettings fills defaults and clamps ranges', () => {
  assert.deepEqual(
    normalizeSettings({ enabled: 'yes', action: 'sleep', idleMinutes: 9999, countdownSeconds: -5, windowStart: 'bad', countJobs: 'no' }),
    { enabled: false, action: 'shutdown', idleMinutes: 720, countdownSeconds: 0, windowStart: '', windowEnd: '', countJobs: true },
  )
  assert.equal(normalizeSettings(null).idleMinutes, 10)
})

test('validatePatch rejects bad values and one-sided windows', () => {
  assert.equal(validatePatch({ action: 'sleep' }).errors.length, 1)
  assert.equal(validatePatch({ idleMinutes: -1 }).errors.length, 1)
  assert.equal(validatePatch({ countdownSeconds: '60' }).errors.length, 1)
  assert.equal(validatePatch({ windowStart: '25:00', windowEnd: '08:00' }).errors.length, 1)
  assert.equal(validatePatch({ windowStart: '22:00' }).errors.length, 1)
  assert.equal(validatePatch({ windowStart: '22:00', windowEnd: '' }).errors.length, 1)
  assert.equal(validatePatch({ windowStart: '', windowEnd: '' }).errors.length, 0)
  assert.equal(validatePatch({ windowStart: '22:00', windowEnd: '08:00' }).errors.length, 0)

  const good = validatePatch({
    enabled: true,
    action: 'hibernate',
    idleMinutes: 3,
    countdownSeconds: 20,
    windowStart: '22:30',
    windowEnd: '07:00',
    countJobs: false,
  })
  assert.equal(good.errors.length, 0)
  assert.deepEqual(good.clean, {
    enabled: true,
    action: 'hibernate',
    idleMinutes: 3,
    countdownSeconds: 20,
    windowStart: '22:30',
    windowEnd: '07:00',
    countJobs: false,
  })
})

test('insideWindow handles an overnight window', () => {
  const settings = { windowStart: '22:00', windowEnd: '08:00' }
  assert.equal(insideWindow(settings, new Date(2026, 0, 1, 23, 30)), true)
  assert.equal(insideWindow(settings, new Date(2026, 0, 1, 12, 0)), false)
  assert.equal(insideWindow(settings, new Date(2026, 0, 2, 7, 59)), true)
  assert.equal(insideWindow(settings, new Date(2026, 0, 2, 8, 0)), false)
  assert.equal(insideWindow({ windowStart: '', windowEnd: '' }, new Date(2026, 0, 1, 12, 0)), true)
  assert.equal(insideWindow({ windowStart: '09:00', windowEnd: '09:00' }, new Date(2026, 0, 1, 12, 0)), true)
})

test('arms after work, then executes the captured action after the countdown', async () => {
  const h = setup()
  await h.engine.tick()
  assert.equal(h.engine.status().phase, 'idle')

  h.startWork()
  await h.engine.tick()
  assert.equal(h.engine.status().phase, 'armed')
  assert.equal(h.engine.status().runningAgents, 1)

  h.stopWork()
  await h.engine.tick()
  assert.equal(h.engine.status().phase, 'waiting-idle')

  await h.engine.tick()
  assert.equal(h.engine.status().phase, 'countdown')

  h.advance(5000)
  await h.engine.tick()
  const state = h.engine.status()
  assert.equal(state.lastAction, 'none')
  assert.equal(state.lastOutcome, 'executed')
  assert.equal(state.phase, 'idle')
})

test('changing the action cancels the running countdown', async () => {
  const h = setup()
  h.startWork()
  await h.engine.tick()
  h.stopWork()
  await h.engine.tick()
  await h.engine.tick()
  assert.equal(h.engine.status().phase, 'countdown')

  assert.equal(h.engine.update({ action: 'lock' }).ok, true)
  assert.equal(h.engine.status().lastOutcome, 'cancelled-by-config')

  h.advance(10_000)
  await h.engine.tick()
  assert.notEqual(h.engine.status().lastOutcome, 'executed')
})

test('a dry run cannot replace a real countdown', async () => {
  const h = setup()
  h.startWork()
  await h.engine.tick()
  h.stopWork()
  await h.engine.tick()
  await h.engine.tick()
  assert.equal(h.engine.status().phase, 'countdown')

  const result = h.engine.test()
  assert.equal(result.ok, false)
  assert.equal(h.engine.status().phase, 'countdown')
})

test('cancel reports that a pending plan was cancelled', async () => {
  const h = setup()
  h.startWork()
  await h.engine.tick()
  h.stopWork()
  await h.engine.tick()

  const result = h.engine.cancel('user')
  assert.equal(result.ok, true)
  assert.equal(result.cancelled, true)
  assert.equal(h.engine.status().armed, false)
})

test('running background jobs keep the schedule waiting', async () => {
  const h = setup()
  h.state.jobs.push({ id: 'j1', status: 'running' })
  h.startWork()
  await h.engine.tick()
  await h.engine.tick()
  assert.equal(h.engine.status().runningJobs, 1)

  h.state.jobs.length = 0
  h.stopWork()
  await h.engine.tick()
  await h.engine.tick()
  assert.equal(h.engine.status().phase, 'countdown')
})
