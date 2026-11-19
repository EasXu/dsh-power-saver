/**
 * dsh-power-saver — Host half.
 *
 * Watches every live agent (and, when asked, every background job), and when
 * nothing runs any more for a configurable idle period, offers a countdown and
 * then performs one OS action: shut down, hibernate, lock, or nothing at all
 * (a dry-run that only records the outcome).
 *
 * The browser half talks to this half through the package-private
 * `/api/power-saver/*` routes. The settings live in `$DSH_HOME/power-saver.json`
 * so they survive profile upgrades and never require editing `cordis.patch.yml`.
 *
 * No Harness package is imported on purpose: a bundle installed from a local
 * directory resolves only its own files plus Node builtins, and this plugin
 * must keep working without depending on the installation's node_modules.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Loader row name. */
export const name = 'power-saver'

/** Serve the browser half's routes; the plugin is meaningless without them. */
export const inject = ['webServer']

/** Route prefix, matched by `client.js`. */
const ROUTE_PREFIX = '/api/power-saver'

/** Request bodies are tiny patches; anything large is a mistake. */
const MAX_BODY_BYTES = 16 * 1024

/** Publicly selectable actions. `none` records the flow without touching the OS. */
const ACTIONS = ['shutdown', 'hibernate', 'lock', 'none']

/** Settings shown before the user changes anything. */
const DEFAULTS = Object.freeze({
  enabled: false,
  action: 'shutdown',
  idleMinutes: 10,
  countdownSeconds: 60,
  windowStart: '',
  windowEnd: '',
  countJobs: true,
})

/** Host file holding the settings. */
function settingsPath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'power-saver.json')
}

/** Clamp a numeric setting, falling back when the value is unusable. */
function clampNumber(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** `HH:MM` to minutes since midnight, or `null` when unset or malformed. */
function parseTime(value) {
  if (typeof value !== 'string') return null
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (match === null) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Normalize a persisted object into a complete settings value.
 * @param raw - whatever was read from disk or submitted.
 * @returns complete settings; unknown or invalid fields fall back.
 */
function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const windowStart = typeof source.windowStart === 'string' && parseTime(source.windowStart) !== null ? source.windowStart.trim() : ''
  const windowEnd = typeof source.windowEnd === 'string' && parseTime(source.windowEnd) !== null ? source.windowEnd.trim() : ''
  return {
    enabled: source.enabled === true,
    action: ACTIONS.includes(source.action) ? source.action : DEFAULTS.action,
    idleMinutes: clampNumber(source.idleMinutes, 0, 720, DEFAULTS.idleMinutes),
    countdownSeconds: clampNumber(source.countdownSeconds, 0, 1800, DEFAULTS.countdownSeconds),
    windowStart,
    windowEnd,
    countJobs: source.countJobs !== false,
  }
}

/**
 * Validate a partial patch and return only its known fields.
 * @param patch - untrusted object from the browser.
 * @returns `errors` for the caller, and `clean` with the accepted fields.
 */
function validatePatch(patch) {
  const errors = []
  const clean = {}
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { errors: ['配置格式不正确'], clean }
  }
  if ('enabled' in patch) {
    if (typeof patch.enabled === 'boolean') clean.enabled = patch.enabled
    else errors.push('enabled 必须是布尔值')
  }
  if ('action' in patch) {
    if (ACTIONS.includes(patch.action)) clean.action = patch.action
    else errors.push('action 只能是 shutdown、hibernate、lock 或 none')
  }
  if ('idleMinutes' in patch) {
    if (typeof patch.idleMinutes === 'number' && Number.isFinite(patch.idleMinutes) && patch.idleMinutes >= 0 && patch.idleMinutes <= 720) {
      clean.idleMinutes = Math.round(patch.idleMinutes)
    } else errors.push('空闲等待必须是 0 到 720 之间的分钟数')
  }
  if ('countdownSeconds' in patch) {
    if (typeof patch.countdownSeconds === 'number' && Number.isFinite(patch.countdownSeconds) && patch.countdownSeconds >= 0 && patch.countdownSeconds <= 1800) {
      clean.countdownSeconds = Math.round(patch.countdownSeconds)
    } else errors.push('倒计时必须是 0 到 1800 之间的秒数')
  }
  let windowIssues = false
  for (const key of ['windowStart', 'windowEnd']) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (typeof value !== 'string') { errors.push(`${key} 必须是 HH:MM 或留空`); windowIssues = true; continue }
    if (value.trim() === '') { clean[key] = ''; continue }
    if (parseTime(value) === null) { errors.push(`${key} 必须是 24 小时制的 HH:MM`); windowIssues = true; continue }
    clean[key] = value.trim()
  }
  if (!windowIssues && ('windowStart' in patch || 'windowEnd' in patch)) {
    if (!('windowStart' in patch) || !('windowEnd' in patch)) {
      errors.push('生效时段需要同时提供开始和结束时间，或都留空')
    } else if ((clean.windowStart === '') !== (clean.windowEnd === '')) {
      errors.push('生效时段需要同时填写开始和结束，或都留空')
    }
  }
  if ('countJobs' in patch) {
    if (typeof patch.countJobs === 'boolean') clean.countJobs = patch.countJobs
    else errors.push('countJobs 必须是布尔值')
  }
  return { errors, clean }
}

/**
 * Whether `now` lies inside the optional active window.
 * An empty or equal pair means "all day".
 * @param settings - normalized settings.
 * @param date - the instant to test.
 * @returns true when the action may run.
 */
function insideWindow(settings, date) {
  const start = parseTime(settings.windowStart)
  const end = parseTime(settings.windowEnd)
  if (start === null || end === null || start === end) return true
  const minutes = date.getHours() * 60 + date.getMinutes()
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}

/** Read settings from disk, ignoring an unreadable or corrupt file. */
function loadSettingsFromDisk() {
  try {
    const text = readFileSync(settingsPath(), 'utf8')
    return normalizeSettings(JSON.parse(text))
  } catch {
    return { ...DEFAULTS }
  }
}

/** Persist settings atomically; throws with a readable message on failure. */
function saveSettingsToDisk(settings) {
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

/** Send one JSON response. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
  } catch {
    /* the peer went away; nothing useful to do */
  }
}

/** Read a bounded JSON request body. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('请求体过大')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('请求体不是合法 JSON')
    error.status = 400
    throw error
  }
}

/** Loopback host names a local browser may legitimately use. */
const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])

/** Split a Host/Origin value into `{scheme, hostname, port}`. */
function authorityOf(value, fallbackScheme) {
  if (typeof value !== 'string' || value.trim() === '') return null
  let url
  try {
    url = new URL(value.includes('://') ? value.trim() : `${fallbackScheme ?? 'http'}://${value.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  return { scheme: url.protocol.replace(':', ''), hostname: url.hostname.toLowerCase(), port }
}

/** The Desktop app relays the page from `dsh-app://app`; that Referer is acceptable. */
function isDesktopRelay(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'dsh-app:' && url.hostname === 'app' && url.port === '' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** Structural fallback: loopback Host, same-origin browser, no cross-site fetch. */
function structuralReason(req) {
  const headers = req?.headers ?? {}
  const host = authorityOf(headers.host, 'http')
  if (host === null || !LOOPBACK_NAMES.has(host.hostname)) return 'host-not-loopback'
  if (String(headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return 'cross-site'
  for (const header of ['origin', 'referer']) {
    const raw = headers[header]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    if (header === 'referer' && isDesktopRelay(raw)) {
      if (headers.origin !== undefined || headers['sec-fetch-site'] !== undefined) return 'desktop-relay-markers'
      continue
    }
    const origin = authorityOf(raw.trim())
    if (origin === null) return `${header}-invalid`
    if (origin.scheme !== host.scheme || origin.hostname !== host.hostname || origin.port !== host.port) return `${header}-mismatch`
  }
  return undefined
}

/**
 * Decide whether a page request may use these routes.
 * The kernel's own admission check is used when composed; otherwise an
 * equivalent structural check runs. Failures are refused, never allowed.
 * @returns `undefined` when admitted, else the HTTP status to answer with.
 */
function rejectionFor(req, connection) {
  const admit = connection?.admit
  if (typeof admit === 'function') {
    try {
      const admission = admit.call(connection, req)
      const status = admission !== null && typeof admission === 'object' ? admission.rejection : undefined
      return status === undefined ? (structuralReason(req) === undefined ? undefined : 403) : status
    } catch {
      return 503
    }
  }
  const reject = connection?.requestRejection
  if (typeof reject === 'function') {
    try {
      const status = reject.call(connection, req)
      return status === undefined ? (structuralReason(req) === undefined ? undefined : 403) : status
    } catch {
      return 503
    }
  }
  return structuralReason(req) === undefined ? undefined : 403
}

/** The command that performs one action on this platform. */
function commandFor(action) {
  const windows = process.platform === 'win32'
  const mac = process.platform === 'darwin'
  switch (action) {
    case 'shutdown':
      if (windows) return { file: 'shutdown.exe', args: ['/s', '/t', '0', '/f'] }
      if (mac) return { file: 'osascript', args: ['-e', 'tell application "System Events" to shut down'] }
      return { file: 'systemctl', args: ['poweroff'] }
    case 'hibernate':
      if (windows) return { file: 'shutdown.exe', args: ['/h'] }
      if (mac) return { file: 'pmset', args: ['sleepnow'] }
      return { file: 'systemctl', args: ['hibernate'] }
    case 'lock':
      if (windows) return { file: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] }
      if (mac) return { file: 'pmset', args: ['displaysleepnow'] }
      return { file: 'loginctl', args: ['lock-session'] }
    default:
      return undefined
  }
}

/** Run one OS action without blocking the Host; keep the first stderr lines for diagnosis. */
function performAction(action) {
  if (action === 'none') return Promise.resolve({ ok: true, detail: 'no system action' })
  const command = commandFor(action)
  if (command === undefined) return Promise.resolve({ ok: false, detail: `unsupported action: ${action}` })
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command.file, command.args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    } catch (error) {
      resolve({ ok: false, detail: String(error?.message ?? error) })
      return
    }
    let stderr = ''
    child.stderr?.on('data', chunk => {
      if (stderr.length < 2000) stderr += String(chunk)
    })
    let settled = false
    const finish = (ok, detail) => {
      if (settled) return
      settled = true
      resolve({ ok, detail })
    }
    child.once('error', error => finish(false, String(error?.message ?? error)))
    child.once('exit', code => {
      if (code === 0 || code === null) {
        finish(true, 'started')
        return
      }
      const message = stderr.trim().replace(/\s+/g, ' ').slice(0, 300)
      finish(false, message === '' ? `exit ${code}` : message)
    })
    const guard = setTimeout(() => finish(true, 'started'), 15_000)
    if (typeof guard.unref === 'function') guard.unref()
    if (typeof child.unref === 'function') child.unref()
  })
}

/**
 * Build the watcher. Exported through `__test` with an injectable clock so the
 * whole state machine can be exercised without waiting minutes or shutting
 * anything down.
 *
 * @param ctx - Host context (services are read lazily so late mounts work).
 * @param options - clock and persistence overrides.
 * @returns the engine handle used by `apply`.
 */
export function createEngine(ctx, options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const load = typeof options.loadSettings === 'function' ? options.loadSettings : loadSettingsFromDisk
  const save = typeof options.saveSettings === 'function' ? options.saveSettings : saveSettingsToDisk
  const log = typeof options.log === 'function' ? options.log : () => {}

  let settings = normalizeSettings(load())
  const running = new Set()
  let armed = false
  let idleSince = null
  /** @type {{ kind: 'action' | 'test', action?: string, endsAt: number, totalMs: number } | null} */
  let countdown = null
  let last = { action: '', outcome: '', at: 0, detail: '' }
  let skipped = ''
  let executing = false

  /** Live running agent ids, combining tracked events with the live registry. */
  function runningAgentIds() {
    const ids = new Set(running)
    try {
      const agents = ctx.get('agents')
      if (agents !== null && agents !== undefined && typeof agents.list === 'function') {
        for (const agent of agents.list()) {
          if (agent !== null && agent !== undefined && agent.status === 'running' && agent.id !== undefined) ids.add(agent.id)
        }
      }
    } catch {
      /* a failing registry must not stop the timer from reading tracked events */
    }
    return ids
  }

  /** Running background jobs, when the composition has the service. */
  function runningJobCount() {
    if (!settings.countJobs) return 0
    try {
      const jobs = ctx.get('jobs')
      if (jobs === null || jobs === undefined || typeof jobs.list !== 'function') return 0
      let count = 0
      for (const job of jobs.list()) {
        if (job !== null && job !== undefined && (job.status === 'running' || job.status === 'stopping')) count += 1
      }
      return count
    } catch {
      return 0
    }
  }

  /** How many things are still running right now. */
  function measure() {
    return { agents: runningAgentIds().size, jobs: runningJobCount() }
  }

  /** Flush live sessions so a shutdown does not lose the last log entries. */
  async function flushSessions() {
    try {
      const sessions = ctx.get('sessions')
      if (sessions === null || sessions === undefined || typeof sessions.list !== 'function') return
      const work = sessions.list().map(session => {
        try {
          return typeof sessions.flush === 'function' ? Promise.resolve(sessions.flush(session)).catch(() => false) : Promise.resolve(false)
        } catch {
          return Promise.resolve(false)
        }
      })
      await Promise.race([
        Promise.all(work),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ])
    } catch {
      /* flushing is best effort */
    }
  }

  /** Perform the captured action after the countdown expired. */
  async function execute(action) {
    countdown = null
    armed = false
    idleSince = null
    executing = true
    try {
      await flushSessions()
      const result = await performAction(action)
      last = { action, outcome: result.ok ? 'executed' : 'failed', at: now(), detail: result.detail }
      log(`action ${action}: ${result.ok ? 'executed' : 'failed'} (${result.detail})`)
    } finally {
      executing = false
    }
  }

  /** One clock step; safe to call more often than once a second. */
  async function tick() {
    if (executing) return
    const at = now()
    const activity = measure()
    const active = activity.agents + activity.jobs > 0

    if (countdown !== null && countdown.kind === 'test') {
      if (at >= countdown.endsAt) {
        countdown = null
        armed = false
        idleSince = null
        last = { action: 'test', outcome: 'test-ok', at, detail: '试运行完成，没有执行系统操作' }
        log('dry run finished')
      }
      return
    }

    if (!settings.enabled) {
      armed = false
      idleSince = null
      countdown = null
      skipped = ''
      return
    }

    if (active) {
      if (countdown !== null) {
        const action = countdown.action ?? settings.action
        countdown = null
        last = { action, outcome: 'cancelled-by-work', at, detail: '有新的项目开始运行，倒计时已取消' }
        log('countdown cancelled: work resumed')
      }
      armed = true
      idleSince = null
      skipped = ''
      return
    }

    if (!armed) return

    if (idleSince === null) {
      idleSince = at
      return
    }

    if (countdown !== null) {
      if (at >= countdown.endsAt) await execute(countdown.action ?? settings.action)
      return
    }

    if (at - idleSince < settings.idleMinutes * 60_000) return

    if (!insideWindow(settings, new Date(at))) {
      skipped = 'outside-window'
      armed = false
      idleSince = null
      return
    }

    skipped = ''
    const totalMs = settings.countdownSeconds * 1000
    if (totalMs <= 0) {
      await execute(settings.action)
      return
    }
    countdown = { kind: 'action', action: settings.action, endsAt: at + totalMs, totalMs }
    last = { action: settings.action, outcome: 'countdown-started', at, detail: '' }
    log(`countdown started: ${settings.countdownSeconds}s before ${settings.action}`)
  }

  /** Render the state the browser half polls. */
  function status() {
    const at = now()
    const activity = measure()
    const pending = countdown
    let phase
    if (executing) phase = 'executing'
    else if (pending !== null) phase = pending.kind === 'test' ? 'test' : 'countdown'
    else if (!settings.enabled) phase = 'disabled'
    else if (armed) phase = idleSince === null ? 'armed' : 'waiting-idle'
    else phase = 'idle'
    return {
      enabled: settings.enabled,
      action: settings.action,
      phase,
      armed,
      skipped,
      runningAgents: activity.agents,
      runningJobs: activity.jobs,
      idleSeconds: idleSince === null ? null : Math.max(0, Math.floor((at - idleSince) / 1000)),
      idleLimitSeconds: settings.idleMinutes * 60,
      countdownEndsAt: pending === null ? null : pending.endsAt,
      countdownSecondsLeft: pending === null ? null : Math.max(0, Math.ceil((pending.endsAt - at) / 1000)),
      countdownKind: pending === null ? null : pending.kind,
      insideWindow: insideWindow(settings, new Date(at)),
      lastAction: last.action,
      lastOutcome: last.outcome,
      lastAt: last.at,
      lastDetail: last.detail,
    }
  }

  /** Merge a validated patch, persist it, and return the status. */
  function update(patch) {
    const { errors, clean } = validatePatch(patch)
    if (errors.length > 0) return { ok: false, errors }
    if (Object.keys(clean).length === 0) return { ok: false, errors: ['没有需要保存的字段'] }
    const previousAction = settings.action
    const next = { ...settings, ...clean }
    try {
      save(next)
    } catch (error) {
      return { ok: false, errors: [`保存失败：${String(error?.message ?? error)}`] }
    }
    settings = next
    if (!settings.enabled) {
      armed = false
      idleSince = null
      countdown = null
    } else if (clean.action !== undefined && clean.action !== previousAction && countdown !== null && countdown.kind === 'action') {
      // The running countdown belongs to the action the user confirmed; a
      // different action must never inherit that countdown.
      countdown = null
      armed = false
      idleSince = null
      last = { action: settings.action, outcome: 'cancelled-by-config', at: now(), detail: '动作已修改，原倒计时已取消' }
    }
    return { ok: true }
  }

  /** Stop an armed schedule or a running countdown. */
  function cancel(reason = 'user') {
    if (executing) return { ok: false, error: '正在执行电源操作，已经无法取消' }
    const wasCounting = countdown !== null && countdown.kind === 'action'
    const wasArmed = armed
    countdown = null
    armed = false
    idleSince = null
    skipped = ''
    last = { action: settings.action, outcome: 'cancelled', at: now(), detail: reason === 'user' ? '用户取消了自动关机' : reason }
    return { ok: true, cancelled: wasCounting || wasArmed, wasCounting }
  }

  /** Start a short dry run that never touches the OS. */
  function test() {
    if (countdown !== null && countdown.kind === 'action') {
      return { ok: false, error: '正在执行关机倒计时，无法同时试运行；请先取消当前倒计时' }
    }
    const seconds = Math.max(3, Math.min(10, settings.countdownSeconds > 0 ? settings.countdownSeconds : 5))
    armed = false
    idleSince = null
    countdown = { kind: 'test', endsAt: now() + seconds * 1000, totalMs: seconds * 1000 }
    last = { action: 'test', outcome: 'test-started', at: now(), detail: '' }
    return { ok: true, seconds }
  }

  /**
   * Record an observed agent transition. Arming on the event itself keeps a
   * run that starts and ends between two clock ticks from being missed, and
   * cancels a pending countdown the moment new work appears.
   */
  function note(agentId, status) {
    if (status === 'running') {
      running.add(agentId)
      armed = true
      idleSince = null
      skipped = ''
      if (countdown !== null && countdown.kind === 'action') {
        last = { action: countdown.action ?? settings.action, outcome: 'cancelled-by-work', at: now(), detail: '有新的项目开始运行，倒计时已取消' }
        countdown = null
        log('countdown cancelled: work resumed')
      }
      return
    }
    running.delete(agentId)
  }

  /** Seed from the live registry so a restart mid-run does not arm needlessly. */
  function start() {
    for (const agent of runningAgentIds()) running.add(agent)
    if (running.size > 0) armed = true
    return engine
  }

  const engine = {
    start,
    tick,
    status,
    update,
    cancel,
    test,
    settings: () => settings,
    /** Test hook: simulate events without a live Host. */
    _note: note,
  }
  return engine
}

/**
 * Register the Host half: event listeners, the one-second clock, and the routes.
 * @param ctx - Host context.
 */
export function apply(ctx) {
  const log = message => {
    try {
      ctx.logger?.info?.(`[power-saver] ${message}`)
    } catch {
      /* logging must never break the watcher */
    }
  }
  const engine = createEngine(ctx, { log }).start()

  ctx.effect(() => {
    const timer = setInterval(() => {
      engine.tick().catch(error => log(`tick failed: ${String(error?.message ?? error)}`))
    }, 1000)
    return () => clearInterval(timer)
  }, 'power-saver: clock')

  ctx.effect(() => ctx.on('agent/status', payload => {
    const agent = payload?.agent
    const id = agent?.id
    if (id === undefined) return
    engine._note(id, payload.status)
  }), 'power-saver: agent status')

  ctx.effect(() => ctx.on('agent/disposed', payload => {
    const id = payload?.agent?.id
    if (id !== undefined) engine._note(id, 'idle')
  }), 'power-saver: agent disposal')

  /** Answer one settings request. */
  async function handle(req, res) {
    const rejection = rejectionFor(req, ctx.get('connection'))
    if (rejection !== undefined) {
      sendJson(res, rejection, { ok: false, error: '请求未通过本机信任检查' })
      return
    }
    let pathname
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      sendJson(res, 400, { ok: false, error: '无法解析请求地址' })
      return
    }
    const route = pathname.slice(ROUTE_PREFIX.length).replace(/\/+$/, '') || '/'
    const method = String(req.method ?? 'GET').toUpperCase()
    try {
      if (method === 'GET' && (route === '/status' || route === '/')) {
        sendJson(res, 200, { ok: true, settings: engine.settings(), state: engine.status() })
        return
      }
      if (method === 'POST' && route === '/config') {
        const body = await readJsonBody(req)
        const patch = body !== null && typeof body === 'object' && body.patch !== undefined ? body.patch : body
        const result = engine.update(patch)
        if (!result.ok) {
          sendJson(res, 400, { ok: false, errors: result.errors })
          return
        }
        sendJson(res, 200, { ok: true, settings: engine.settings(), state: engine.status() })
        return
      }
      if (method === 'POST' && route === '/cancel') {
        const result = engine.cancel('user')
        if (!result.ok) {
          sendJson(res, 409, { ok: false, error: result.error })
          return
        }
        sendJson(res, 200, { ok: true, cancelled: result.cancelled, settings: engine.settings(), state: engine.status() })
        return
      }
      if (method === 'POST' && route === '/test') {
        const result = engine.test()
        if (!result.ok) {
          sendJson(res, 409, { ok: false, error: result.error })
          return
        }
        sendJson(res, 200, { ok: true, settings: engine.settings(), state: engine.status() })
        return
      }
      sendJson(res, 404, { ok: false, error: 'unknown route' })
    } catch (error) {
      sendJson(res, Number(error?.status) || 500, { ok: false, error: String(error?.message ?? error) })
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: handle,
  }), 'power-saver: routes')

  log(`ready (settings: ${settingsPath()})`)
}

/** Pure helpers and the engine factory for tests. */
export const __test = {
  DEFAULTS,
  ROUTE_PREFIX,
  normalizeSettings,
  validatePatch,
  insideWindow,
  parseTime,
  createEngine,
  commandFor,
}
