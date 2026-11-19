/**
 * dsh-power-saver — browser half.
 *
 * The whole feature lives in the left sidebar: one footer action beside
 * Settings (自动关机) opens a panel anchored above the sidebar foot with the
 * live status, the settings form, and, while a countdown runs, the remaining
 * time and its cancel button. The footer row itself also carries the countdown
 * so it is visible without opening the panel.
 *
 * All state and every action live in the Host half behind
 * `/api/power-saver/*`; this module never decides on its own to power anything
 * off. It is plain CommonJS evaluated by the Harness module loader, so it does
 * not import any Harness Client package.
 */

window.__ModuleLoader__.load({
  id: 'dsh-power-saver',
  factory(require) {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useLayoutEffect, useRef, useState } = React

    /** Must match the Host half. */
    const API = '/api/power-saver'
    /** Locale namespace owned by this plugin. */
    const NS = 'powerSaver'
    /** Actions the Host accepts, in menu order. */
    const ACTIONS = ['shutdown', 'hibernate', 'lock', 'none']

    const ZH = {
      'trigger.label': '自动关机',
      'trigger.off': '已关闭',
      'trigger.waiting': '等待项目',
      'trigger.running': '运行中 {count}',
      'trigger.armed': '等待结束',
      'trigger.idle': '空闲等待',
      'trigger.executing': '执行中',
      'panel.title': '自动关机 / 休眠',
      'panel.close': '关闭',
      'panel.loading': '正在读取状态…',
      'status.off': '已关闭',
      'status.offDetail': '不会自动执行任何电源操作。',
      'status.idle': '已启用 · 等待项目运行',
      'status.idleDetail': '开始运行项目后，这里会显示进度。',
      'status.running': '已启用 · 项目运行中',
      'status.waiting': '已启用 · 等待项目结束',
      'status.waitingDetail': '所有项目都已结束，开始计算空闲时间。',
      'status.idleWait': '已启用 · 空闲等待中',
      'status.countdown': '倒计时中',
      'status.test': '试运行中',
      'status.executing': '正在执行…',
      'status.executingDetail': '正在刷新会话日志并执行操作，此时无法取消。',
      'status.runningLine': '正在运行：{agents} 个会话、{jobs} 个后台任务',
      'status.idleLine': '所有项目已结束，已空闲 {time}',
      'status.windowLine': '当前不在生效时段 {start}–{end} 内',
      'status.skipped': '上次已跳过：开始倒计时时不在生效时段内',
      'status.lastExecuted': '上次执行：{action} · {time}',
      'status.lastFailed': '上次执行失败：{detail}',
      'status.lastCancelled': '上次计划已取消：{reason}',
      'status.lastTest': '上次试运行完成（没有执行系统操作）',
      'countdown.title': '自动关机倒计时',
      'countdown.text': '将执行：{action}',
      'countdown.detail': '所有项目已结束',
      'countdown.cancel': '取消',
      'countdown.cancelFailed': '取消失败，请立即操作或关闭 DSH',
      'trigger.test': '试运行 {time}',
      'duration.seconds': '{n} 秒',
      'duration.minutes': '{n} 分钟',
      'duration.minutesSeconds': '{m} 分 {s} 秒',
      'summary.line': '计划：{action} · {window} · {timing}',
      'summary.idleThen': '空闲 {idle} 后倒计时 {countdown}',
      'summary.idleOnly': '空闲 {idle} 后立即执行',
      'summary.countdownOnly': '项目结束后倒计时 {countdown}',
      'summary.now': '项目结束后立即执行',
      'summary.windowAllDay': '全天生效',
      'summary.windowRange': '{start}–{end}',
      'section.trigger': '触发条件',
      'action.shutdown': '关机',
      'action.hibernate': '休眠',
      'action.lock': '锁定屏幕',
      'action.none': '只提示，不执行',
      'section.action': '触发动作',
      'section.actionHint': '「关机」会强制关闭其他程序；「休眠」需要系统已启用休眠（管理员终端运行 powercfg /hibernate on）。不确定时先用「试运行」或「只提示，不执行」。',
      'section.idle': '空闲等待',
      'section.idleHint': '所有项目结束后，再观察多久才认为「真的结束了」。0 表示立即开始倒计时（0–720 分钟）。',
      'section.countdown': '执行倒计时',
      'section.countdownHint': '真正执行前的缓冲时间，期间可以取消。0 表示不等待（0–1800 秒）。',
      'section.window': '生效时段',
      'section.windowStart': '开始时间',
      'section.windowEnd': '结束时间',
      'time.pick': '点击选择时间',
      'time.title': '选择时间',
      'time.hour': '时',
      'time.minute': '分',
      'time.clear': '清除',
      'time.done': '完成',
      'time.none': '未设置',
      'section.windowHint': '开始和结束都留空表示全天生效；填写时必须两个都填，点击时间框可直接选择时间。跨零点请让开始晚于结束，例如 22:00–08:00。',
      'section.countJobs': '统计后台任务',
      'section.countJobsHint': 'DSH 后台任务也算「项目未结束」，避免任务被中断。',
      'unit.minute': '分钟',
      'unit.second': '秒',
      'save': '保存设置',
      'saving': '保存中…',
      'saved': '已保存',
      'unsaved': '有未保存的修改',
      'test': '试运行',
      'testing': '试运行中…',
      'cancel': '取消自动关机',
      'cancelDone': '已取消，不会再自动执行',
      'cancelNothing': '当前没有待执行的计划',
      'testStarted': '试运行开始，稍后显示结果',
      'refresh': '重新读取',
      'toggle.label': '启用',
      'toggle.enabled': '启用自动关机',
      'error.read': '读取状态失败：{detail}',
      'error.save': '保存失败：{detail}',
      'error.cancel': '取消失败，倒计时可能仍在进行：{detail}',
      'error.test': '试运行未能启动：{detail}',
      'error.hint': '如果一直失败，请刷新页面后重试。',
      'confirm.title': '确认启用自动电源操作？',
      'confirm.body': '启用后会按这份计划执行：{summary}。关机或休眠会强制关闭其他程序；如果还不放心，可以先把动作改成「只提示，不执行」再启用。',
      'confirm.ok': '确认启用',
      'confirm.cancel': '暂不启用',
      'hint.cancel': '取消方式：点「取消自动关机」，或向任意会话发送一条消息（有项目开始运行会自动取消）。',
      'hint.scope': '插件随 DSH 运行；退出 DSH 会一起取消计时。卸载或停用插件即彻底关闭此功能。',
      'hint.scopeOnly': '只统计 DSH 的会话与后台任务；DSH 之外的编译、终端脚本不会被检测。',
    }

    const EN = {
      'trigger.label': 'Auto power-off',
      'trigger.off': 'Off',
      'trigger.waiting': 'Waiting for work',
      'trigger.running': '{count} running',
      'trigger.armed': 'Waiting',
      'trigger.idle': 'Idle wait',
      'trigger.executing': 'Acting',
      'panel.title': 'Auto power-off / hibernate',
      'panel.close': 'Close',
      'panel.loading': 'Reading status…',
      'status.off': 'Off',
      'status.offDetail': 'No power action will be taken.',
      'status.idle': 'On · waiting for a project',
      'status.idleDetail': 'Progress appears here once something runs.',
      'status.running': 'On · projects running',
      'status.waiting': 'On · waiting for projects to finish',
      'status.waitingDetail': 'Everything has finished; the idle timer is running.',
      'status.idleWait': 'On · idle wait',
      'status.countdown': 'Counting down',
      'status.test': 'Dry run',
      'status.executing': 'Running the action…',
      'status.executingDetail': 'Flushing session logs and performing the action; it cannot be cancelled now.',
      'status.runningLine': 'Running: {agents} sessions, {jobs} background jobs',
      'status.idleLine': 'All projects finished; idle for {time}',
      'status.windowLine': 'Outside the active window {start}–{end}',
      'status.skipped': 'Skipped last time: the countdown started outside the active window',
      'status.lastExecuted': 'Last action: {action} · {time}',
      'status.lastFailed': 'Last action failed: {detail}',
      'status.lastCancelled': 'Last plan cancelled: {reason}',
      'status.lastTest': 'Last dry run completed (no system action)',
      'countdown.title': 'Auto power-off countdown',
      'countdown.text': 'Will {action}',
      'countdown.detail': 'All projects have finished',
      'countdown.cancel': 'Cancel',
      'countdown.cancelFailed': 'Cancel failed — act now or quit DSH',
      'trigger.test': 'Dry run {time}',
      'duration.seconds': '{n}s',
      'duration.minutes': '{n} min',
      'duration.minutesSeconds': '{m} min {s}s',
      'summary.line': 'Plan: {action} · {window} · {timing}',
      'summary.idleThen': 'after {idle} idle, a {countdown} countdown',
      'summary.idleOnly': 'after {idle} idle, act immediately',
      'summary.countdownOnly': 'a {countdown} countdown after the work ends',
      'summary.now': 'immediately after the work ends',
      'summary.windowAllDay': 'all day',
      'summary.windowRange': '{start}–{end}',
      'section.trigger': 'Trigger',
      'action.shutdown': 'shut down',
      'action.hibernate': 'hibernate',
      'action.lock': 'lock the screen',
      'action.none': 'notify only',
      'section.action': 'Action',
      'section.actionHint': '"Shut down" force-closes other applications; "hibernate" needs hibernation enabled (run powercfg /hibernate on as administrator). Try "Dry run" or "Notify only" first.',
      'section.idle': 'Idle wait',
      'section.idleHint': 'How long every project must stay finished before the countdown. 0 starts it immediately (0–720 min).',
      'section.countdown': 'Countdown',
      'section.countdownHint': 'Grace period before acting; cancel it any time. 0 acts immediately (0–1800 s).',
      'section.window': 'Active window',
      'section.windowStart': 'Start time',
      'section.windowEnd': 'End time',
      'time.pick': 'Click to pick a time',
      'time.title': 'Pick a time',
      'time.hour': 'Hour',
      'time.minute': 'Minute',
      'time.clear': 'Clear',
      'time.done': 'Done',
      'time.none': 'Not set',
      'section.windowHint': 'Leave both empty for all day; if you fill one, fill both. Click a time field to pick it. For a window across midnight, start later than end, e.g. 22:00–08:00.',
      'section.countJobs': 'Count background jobs',
      'section.countJobsHint': 'DSH background jobs keep the schedule waiting instead of being interrupted.',
      'unit.minute': 'min',
      'unit.second': 's',
      'save': 'Save settings',
      'saving': 'Saving…',
      'saved': 'Saved',
      'unsaved': 'Unsaved changes',
      'test': 'Dry run',
      'testing': 'Dry run…',
      'cancel': 'Cancel auto power-off',
      'cancelDone': 'Cancelled; nothing will run',
      'cancelNothing': 'No pending plan is running',
      'testStarted': 'Dry run started; the result appears here',
      'refresh': 'Reload',
      'toggle.label': 'Enable',
      'toggle.enabled': 'Enable auto power-off',
      'error.read': 'Could not read status: {detail}',
      'error.save': 'Could not save: {detail}',
      'error.cancel': 'Cancel failed; a countdown may still be running: {detail}',
      'error.test': 'The dry run could not start: {detail}',
      'error.hint': 'If this keeps failing, reload the page and try again.',
      'confirm.title': 'Enable automatic power actions?',
      'confirm.body': 'Enabling applies this plan: {summary}. Shutting down or hibernating force-closes other applications; if unsure, change the action to "Notify only" first.',
      'confirm.ok': 'Enable',
      'confirm.cancel': 'Not now',
      'hint.cancel': 'To cancel: press "Cancel auto power-off", or send a message to any session (running work cancels it automatically).',
      'hint.scope': 'The plugin lives inside DSH; quitting DSH cancels any countdown. Uninstall or disable the plugin to turn the feature off for good.',
      'hint.scopeOnly': 'Only DSH sessions and DSH background jobs are counted; builds and scripts outside DSH are invisible.',
    }

    const CSS = `
.psb-layer{position:relative;flex:none;display:flex;align-items:center;width:100%;height:42px;margin:8px 0 0}
.psb-trigger{display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:0 -2px;padding:0 10px 0 8px;border:none;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;cursor:pointer;overflow:hidden;text-align:left}
@media (hover:hover){.psb-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}}
.psb-trigger[data-active]{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.psb-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.psb-hint{margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}
.psb-hint.is-live{color:var(--dsw-alias-state-warn-primary)}
.psb-dot{display:block;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.psb-dot.on{background:var(--dsw-alias-state-success-primary)}
.psb-dot.busy{background:var(--dsw-alias-brand-primary)}
.psb-dot.count{background:var(--dsw-alias-state-warn-primary)}
.psb-layer.psb-rail{width:36px;height:36px;margin:0}
.psb-rail .psb-trigger{width:36px;height:36px;justify-content:center;padding:0;border-radius:50%}
.psb-rail .psb-label,.psb-rail .psb-hint{display:none}
.psb-rail .psb-dot{position:absolute;top:3px;right:3px;width:7px;height:7px;box-shadow:0 0 0 2px var(--dsw-specific-sidebar-fill)}
.psb-panel{position:fixed;isolation:isolate;z-index:40;display:flex;flex-direction:column;max-height:min(72vh,660px);overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));backdrop-filter:var(--dsw-menu-backdrop-filter,none);box-shadow:var(--dsw-elevation-prominent,0 14px 36px color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent));color:var(--dsw-alias-label-primary)}
.psb-panel:focus{outline:none}
.psb-header{flex:none;display:flex;align-items:center;gap:8px;min-height:44px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.psb-title{flex:1;min-width:0;font-size:14px;font-weight:500;line-height:20px}
.psb-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
@media (hover:hover){.psb-close:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}}
.psb-body{flex:1;min-height:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}
.psb-status{display:flex;align-items:flex-start;gap:10px}
.psb-status .psb-dot{margin-top:6px;flex:none}
.psb-statusText{flex:1;min-width:0}
.psb-statusSwitch{flex:none;display:flex;align-items:center;gap:6px;padding-top:2px}
.psb-statusTitle{font-size:13.5px;font-weight:600;line-height:1.5}
.psb-line{margin-top:2px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);word-break:break-word}
.psb-countdown{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,transparent)}
.psb-bigTime{font-size:22px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-warn-primary);white-space:nowrap}
.psb-countdownText{flex:1;min-width:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);word-break:break-word}
.psb-rows{display:flex;flex-direction:column}
.psb-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.psb-groupTitle + .psb-row{border-top:none;padding-top:2px}
.psb-groupTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:2px 0 4px}
.psb-rowText{flex:1;min-width:0}
.psb-labelText{font-size:13px;font-weight:500;line-height:1.5}
.psb-hintText{margin-top:3px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.psb-control{flex:none;display:flex;align-items:center;gap:6px;padding-top:1px}
.psb-input,.psb-select{height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;outline:none;box-sizing:border-box}
.psb-input:focus,.psb-select:focus{border-color:var(--dsw-alias-brand-primary)}
.psb-input.num{width:68px;text-align:right}
.psb-timeField{display:inline-flex;align-items:center;justify-content:center;height:30px;min-width:88px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;font-variant-numeric:tabular-nums;cursor:pointer}
.psb-timeField:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.psb-timeField:disabled{opacity:.5;cursor:default}
.psb-timeField[data-empty]{color:var(--dsw-alias-label-secondary)}
.psb-timePop{position:fixed;z-index:50;display:flex;flex-direction:column;gap:6px;width:200px;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);color:var(--dsw-alias-label-primary);box-sizing:border-box}
.psb-timeCols{display:flex;gap:6px}
.psb-timeCol{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.psb-timeColTitle{padding:2px 4px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.psb-timeList{position:relative;display:flex;flex-direction:column;gap:1px;height:170px;padding:2px;overflow-y:auto;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.psb-timeItem{flex:none;height:24px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12.5px;font-variant-numeric:tabular-nums;text-align:center;cursor:pointer}
.psb-timeItem:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}
.psb-timeItem[data-selected]{font-weight:600;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.psb-timeFoot{display:flex;align-items:center;gap:6px}
.psb-timeFoot .psb-btn{height:26px;padding:0 8px;font-size:12px}
.psb-timeSpacer{flex:1}
.psb-suffix{font-size:12px;color:var(--dsw-alias-label-secondary)}
.psb-switch{width:38px;height:22px;border:none;border-radius:11px;background:var(--dsw-alias-border-l2);position:relative;cursor:pointer;transition:background .15s ease;flex:none;padding:0}
.psb-switch.is-on{background:var(--dsw-alias-brand-primary)}
.psb-switch:disabled{opacity:.5;cursor:default}
.psb-knob{position:absolute;top:3px;left:3px;display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);transition:transform .15s ease}
.psb-switch.is-on .psb-knob{transform:translateX(16px)}
.psb-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.psb-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;cursor:pointer}
.psb-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.psb-btn:disabled{opacity:.5;cursor:default}
.psb-btn.primary{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:500}
.psb-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.psb-confirm{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 6%,transparent)}
.psb-note{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.psb-note.bad{color:var(--dsw-alias-state-error-primary)}
.psb-note.warn{color:var(--dsw-alias-state-warn-primary)}
.psb-note.ok{color:var(--dsw-alias-state-success-primary)}
.psb-tips{display:flex;flex-direction:column;gap:5px;padding-top:2px}
.psb-pill{position:fixed;right:20px;bottom:22px;z-index:60;pointer-events:auto;max-width:min(360px,calc(100vw - 32px))}
.psb-pillCard{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 28px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
.psb-pillText{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.psb-pillError{max-width:160px;font-size:11px;line-height:1.4;color:var(--dsw-alias-state-error-primary)}
@media (max-width:470px){.psb-row{flex-direction:column;gap:6px}.psb-control{width:100%}}
`

    /** Translate with `{name}` placeholders. */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) => {
        const value = values?.[key]
        return value === undefined || value === null ? match : String(value)
      })
    }

    /** One JSON request with a timeout and readable failures. */
    async function api(path, options) {
      const { timeout = 12000, ...rest } = options ?? {}
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        const response = await fetch(API + path, { ...rest, signal: controller.signal, credentials: 'same-origin' })
        const body = await response.json().catch(() => null)
        if (!response.ok) {
          const detail = body && Array.isArray(body.errors) ? body.errors.join('；') : (body && body.error) || `HTTP ${response.status}`
          throw new Error(detail)
        }
        if (body === null) throw new Error('返回值不是 JSON')
        return body
      } finally {
        clearTimeout(timer)
      }
    }

    /** `mm:ss`. */
    function fmtClock(totalSeconds) {
      const safe = Math.max(0, Math.round(Number(totalSeconds) || 0))
      const minutes = Math.floor(safe / 60)
      const seconds = safe % 60
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }

    /** Human duration in the active language. */
    function fmtIdle(totalSeconds, t) {
      const safe = Math.max(0, Math.round(Number(totalSeconds) || 0))
      if (safe < 60) return fill(t('duration.seconds'), { n: safe })
      const minutes = Math.floor(safe / 60)
      const seconds = safe % 60
      return seconds === 0
        ? fill(t('duration.minutes'), { n: minutes })
        : fill(t('duration.minutesSeconds'), { m: minutes, s: seconds })
    }

    /** Effective window label for the current saved settings. */
    function windowLabel(t, settings) {
      if (!settings?.windowStart || !settings?.windowEnd) return t('summary.windowAllDay')
      return fill(t('summary.windowRange'), { start: settings.windowStart, end: settings.windowEnd })
    }

    /** One-sentence plan summary. */
    function summaryLine(t, settings) {
      if (!settings) return ''
      const action = t(`action.${settings.action}`)
      const idle = Number(settings.idleMinutes) || 0
      const countdown = Number(settings.countdownSeconds) || 0
      let timing
      if (idle > 0 && countdown > 0) timing = fill(t('summary.idleThen'), { idle: fmtIdle(idle * 60, t), countdown: fmtClock(countdown) })
      else if (idle > 0) timing = fill(t('summary.idleOnly'), { idle: fmtIdle(idle * 60, t), action })
      else if (countdown > 0) timing = fill(t('summary.countdownOnly'), { countdown: fmtClock(countdown) })
      else timing = t('summary.now')
      return fill(t('summary.line'), { action, window: windowLabel(t, settings), timing })
    }

    /** Countdown seconds left, up to date with the local clock. */
    function secondsLeft(state, now) {
      if (!state || state.countdownEndsAt === null || state.countdownEndsAt === undefined) return 0
      return Math.max(0, Math.ceil((state.countdownEndsAt - now) / 1000))
    }

    /** Poll the Host status while the sidebar surface is mounted. */
    function useStatus(intervalMs) {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const mounted = useRef(true)
      const load = useCallback(async () => {
        try {
          const next = await api('/status')
          if (!mounted.current) return
          setData(next)
          setError('')
        } catch (failure) {
          if (!mounted.current) return
          setError(String(failure?.message ?? failure))
        }
      }, [])
      useEffect(() => {
        mounted.current = true
        load()
        const timer = setInterval(load, intervalMs)
        return () => {
          mounted.current = false
          clearInterval(timer)
        }
      }, [intervalMs, load])
      return { data, error, reload: load }
    }

    /** Small power glyph used by the trigger and the panel header. */
    function PowerIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('path', { d: 'M12 3v8.5', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
      h('path', { d: 'M7.6 6.3a7.6 7.6 0 1 0 8.8 0', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }))
    }

    /** Close glyph for the panel header. */
    function CloseIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M6 6l12 12M18 6L6 18', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }))
    }

    /** Pad a clock part. */
    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    /** Split `HH:MM`, falling back to a sensible default. */
    function splitTime(value, fallback) {
      const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof value === 'string' ? value : '')
      return match === null ? fallback : [Number(match[1]), Number(match[2])]
    }

    /**
     * Keep a numeric text field digits-only, clamped, and free of leading
     * zeros. The DOM text is rewritten when React's value prop would stay the
     * same, so "030" or "-60" can never remain visible.
     */
    function editNumeric(event, min, max, apply) {
      const input = event.currentTarget
      const digits = String(input.value).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '')
      const parsed = digits === '' ? min : Number(digits)
      const value = Math.min(max, Math.max(min, parsed))
      apply(value)
      if (input.value !== String(value)) input.value = String(value)
    }

    /** A non-looping hour/minute picker for one time field. */
    function TimePopover({ which, left, top, value, t, onChange, onClose }) {
      const rootRef = useRef(null)
      const hourList = useRef(null)
      const minuteList = useRef(null)
      const [hour, minute] = splitTime(value, which === 'start' ? [22, 0] : [8, 0])
      const emit = (nextHour, nextMinute) => onChange(`${pad2(nextHour)}:${pad2(nextMinute)}`)

      useEffect(() => {
        const onPointer = event => {
          const root = rootRef.current
          if (root !== null && root.contains(event.target)) return
          if (event.target instanceof Element && event.target.closest('[data-psb-timefield]') !== null) return
          onClose()
        }
        document.addEventListener('pointerdown', onPointer, true)
        return () => document.removeEventListener('pointerdown', onPointer, true)
      }, [onClose])

      useEffect(() => {
        const center = (list, target) => {
          const item = list?.querySelector(`[data-value="${target}"]`)
          if (item === null || item === undefined || list === null) return
          list.scrollTop = Math.max(0, item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2)
        }
        center(hourList.current, hour)
        center(minuteList.current, minute)
        // Only on open: re-centering after every click would fight the user.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const hours = Array.from({ length: 24 }, (_, index) => index)
      const minutes = Array.from({ length: 60 }, (_, index) => index)
      const column = (title, listRef, values, selected, onPick) => h('div', { className: 'psb-timeCol' },
        h('div', { className: 'psb-timeColTitle' }, title),
        h('div', { ref: listRef, className: 'psb-timeList' },
          values.map(entry => h('button', {
            key: entry,
            type: 'button',
            className: 'psb-timeItem',
            'data-value': entry,
            'data-selected': entry === selected ? true : undefined,
            onClick: () => onPick(entry),
          }, pad2(entry)))))

      return h('div', {
        ref: rootRef,
        className: 'psb-timePop',
        style: { left, top },
        role: 'dialog',
        'aria-label': t('time.title'),
      },
      h('div', { className: 'psb-timeCols' },
        column(t('time.hour'), hourList, hours, hour, nextHour => emit(nextHour, minute)),
        column(t('time.minute'), minuteList, minutes, minute, nextMinute => emit(hour, nextMinute))),
      h('div', { className: 'psb-timeFoot' },
        h('button', {
          type: 'button',
          className: 'psb-btn',
          onClick: () => { onChange(''); onClose() },
        }, t('time.clear')),
        h('span', { className: 'psb-timeSpacer' }),
        h('button', { type: 'button', className: 'psb-btn primary', onClick: onClose }, t('time.done'))))
    }

    /** Accessible switch. */
    function Switch({ checked, disabled, label, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        className: `psb-switch${checked ? ' is-on' : ''}`,
        disabled: disabled === true,
        onClick: () => onChange(!checked),
      }, h('span', { className: 'psb-knob' }))
    }

    /** A labelled form row. */
    function Row({ label, hint, children }) {
      return h('div', { className: 'psb-row' },
        h('div', { className: 'psb-rowText' },
          h('div', { className: 'psb-labelText' }, label),
          hint ? h('div', { className: 'psb-hintText' }, hint) : null),
        h('div', { className: 'psb-control' }, children))
    }

    /** Compose the status lines shown in the panel and the footer. */
    function describe(t, data) {
      if (!data?.state) return { tone: '', title: t('panel.loading'), lines: [] }
      const state = data.state
      const settings = data.settings
      const actionLabel = t(`action.${state.action}`)
      const running = state.runningAgents + state.runningJobs
      const lines = []
      const runningLine = fill(t('status.runningLine'), { agents: state.runningAgents, jobs: state.runningJobs })
      let tone = 'on'
      let title = t('status.idle')

      if (state.phase === 'executing') {
        tone = 'count'
        title = t('status.executing')
        lines.push(t('status.executingDetail'))
      } else if (state.phase === 'countdown' || state.phase === 'test') {
        tone = 'count'
        title = state.phase === 'test' ? t('status.test') : t('status.countdown')
        if (running > 0) lines.push(runningLine)
      } else if (!state.enabled) {
        tone = ''
        title = t('status.off')
        lines.push(t('status.offDetail'))
        if (running > 0) lines.push(runningLine)
      } else if (running > 0) {
        tone = 'busy'
        title = t('status.running')
        lines.push(runningLine)
      } else if (state.phase === 'waiting-idle') {
        title = t('status.idleWait')
        lines.push(fill(t('status.idleLine'), { time: fmtIdle(state.idleSeconds, t) }))
      } else if (state.phase === 'armed') {
        title = t('status.waiting')
        lines.push(t('status.waitingDetail'))
      } else {
        lines.push(t('status.idleDetail'))
      }

      if (settings) lines.push(summaryLine(t, settings))
      if (state.enabled && !state.insideWindow && settings?.windowStart) {
        lines.push(fill(t('status.windowLine'), { start: settings.windowStart, end: settings.windowEnd }))
      }
      if (state.skipped === 'outside-window') lines.push(t('status.skipped'))

      const finished = state.phase === 'idle' || state.phase === 'disabled'
      if (finished && state.lastOutcome !== '' && state.lastOutcome !== 'countdown-started' && state.lastOutcome !== 'test-started') {
        if (state.lastOutcome === 'executed') {
          lines.push(state.lastAction === 'test'
            ? t('status.lastTest')
            : fill(t('status.lastExecuted'), {
              action: t(`action.${state.lastAction}`),
              time: new Date(state.lastAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }))
        } else if (state.lastOutcome === 'failed') {
          lines.push(fill(t('status.lastFailed'), { detail: state.lastDetail }))
        } else if (state.lastOutcome === 'test-ok') {
          lines.push(t('status.lastTest'))
        } else if (state.lastOutcome === 'cancelled' || state.lastOutcome === 'cancelled-by-work' || state.lastOutcome === 'cancelled-by-config') {
          lines.push(fill(t('status.lastCancelled'), { reason: state.lastDetail || t('status.off') }))
        }
      }
      return { tone, title, lines }
    }

    /** Footer hint text: countdown when live, activity otherwise. */
    function triggerHint(t, state, now) {
      if (!state) return ''
      if (state.phase === 'executing') return t('trigger.executing')
      if (state.phase === 'countdown') return fmtClock(secondsLeft(state, now))
      if (state.phase === 'test') return fill(t('trigger.test'), { time: fmtClock(secondsLeft(state, now)) })
      const running = state.runningAgents + state.runningJobs
      if (running > 0) return fill(t('trigger.running'), { count: running })
      if (state.armed) return state.idleSeconds !== null ? t('trigger.idle') : t('trigger.armed')
      return state.enabled ? t('trigger.waiting') : t('trigger.off')
    }

    /** The sidebar footer action and its anchored settings panel. */
    function PowerSaverSidebar({ wide, t }) {
      const { data, error, reload } = useStatus(2000)
      const [open, setOpen] = useState(false)
      const [anchor, setAnchor] = useState(null)
      const [now, setNow] = useState(Date.now())
      const [draft, setDraft] = useState(null)
      const [pending, setPending] = useState('')
      const [notice, setNotice] = useState(null)
      const [confirming, setConfirming] = useState(false)
      const [picker, setPicker] = useState(null)
      const [cancelError, setCancelError] = useState('')
      const rootRef = useRef(null)
      const panelRef = useRef(null)
      const triggerRef = useRef(null)
      const seeded = useRef(false)
      const busy = pending !== ''

      const state = data?.state
      const live = state !== undefined && state !== null
        && (state.phase === 'countdown' || state.phase === 'test' || state.phase === 'executing')
      const counting = state !== undefined && state !== null && (state.phase === 'countdown' || state.phase === 'test')

      useEffect(() => {
        if (!live) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 500)
        return () => clearInterval(timer)
      }, [live])

      // Seed the form once; later saves merge only what was sent.
      useEffect(() => {
        if (seeded.current || !data?.settings) return
        seeded.current = true
        setDraft({ ...data.settings })
      }, [data])

      useEffect(() => {
        if (notice?.tone !== 'ok') return undefined
        const timer = setTimeout(() => setNotice(null), 3000)
        return () => clearTimeout(timer)
      }, [notice])

      // The sidebar clips overflow, so the panel is fixed and hugs the trigger.
      // In drawer mode the column becomes a transformed containing block with
      // its own width, so the panel must fit inside the drawer instead of
      // spilling past its clip.
      useLayoutEffect(() => {
        if (!open) return undefined
        const place = () => {
          const element = rootRef.current
          if (element === null) return
          const rect = element.getBoundingClientRect()
          const drawer = element.closest('[data-sidebar-drawer]')
          const drawerWidth = drawer === null ? null : drawer.getBoundingClientRect().width
          const maxWidth = drawerWidth === null
            ? window.innerWidth - 24
            : Math.min(window.innerWidth - 24, Math.max(260, drawerWidth - 16))
          const width = Math.min(400, maxWidth)
          const left = drawerWidth === null
            ? Math.max(8, Math.min(rect.left, window.innerWidth - width - 12))
            : Math.max(8, Math.min(rect.left, Math.max(8, drawerWidth - width - 8)))
          const bottom = Math.max(16, window.innerHeight - rect.top + 8)
          const maxHeight = Math.max(180, Math.min(660, window.innerHeight - 24, rect.top - 16))
          setAnchor({ left, width, bottom, maxHeight })
        }
        place()
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
        observer?.observe(rootRef.current)
        window.addEventListener('resize', place)
        return () => {
          observer?.disconnect()
          window.removeEventListener('resize', place)
        }
      }, [open, wide])

      // Dismiss on outside pointer or Escape.
      useEffect(() => {
        if (!open) return undefined
        const onPointer = event => {
          const element = rootRef.current
          if (element !== null && !element.contains(event.target)) setOpen(false)
        }
        const onKey = event => {
          if (event.key !== 'Escape') return
          if (picker !== null) {
            setPicker(null)
            return
          }
          setOpen(false)
          triggerRef.current?.focus()
        }
        document.addEventListener('pointerdown', onPointer, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('pointerdown', onPointer, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [open, picker])

      // Move focus into the panel so keyboard users land on its controls.
      useEffect(() => {
        if (open) panelRef.current?.focus()
        else setPicker(null)
      }, [open])

      const serverSettings = data?.settings ?? null
      const view = describe(t, data)
      const keys = ['enabled', 'action', 'idleMinutes', 'countdownSeconds', 'windowStart', 'windowEnd', 'countJobs']
      const pick = source => Object.fromEntries(keys.map(key => [key, source?.[key]]))
      const dirty = draft !== null && serverSettings !== null && JSON.stringify(pick(draft)) !== JSON.stringify(pick(serverSettings))

      /** Re-read the Host values and discard unsaved edits. */
      const reloadAll = () => {
        if (serverSettings !== null) setDraft({ ...serverSettings })
        setNotice(null)
        reload()
      }

      const edit = (key, value) => {
        setNotice(null)
        setDraft(current => (current === null ? current : { ...current, [key]: value }))
      }

      const savePatch = useCallback(async (patch, successText, revert, kind) => {
        setPending(kind)
        setNotice(null)
        try {
          const next = await api('/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ patch }),
          })
          // Only merge the fields that were sent; a partial save must not
          // overwrite edits the user made in other fields meanwhile.
          setDraft(current => ({ ...(current ?? {}), ...patch }))
          setNotice({ tone: 'ok', text: successText ?? t('saved') })
          reload()
        } catch (failure) {
          if (typeof revert === 'function') revert()
          setNotice({ tone: 'bad', text: fill(t('error.save'), { detail: String(failure?.message ?? failure) }) })
        } finally {
          setPending('')
        }
      }, [reload, t])

      const save = () => {
        if (draft === null) return
        savePatch(pick(draft), t('saved'), undefined, 'save')
      }

      /** Persist the whole draft plus the enabled flag, so enabling never drops edits. */
      const applyEnabled = next => {
        if (draft === null) return
        setDraft(current => ({ ...(current ?? {}), enabled: next }))
        savePatch({ ...pick(draft), enabled: next }, t('saved'), () => {
          setDraft(current => ({ ...(current ?? {}), enabled: serverSettings?.enabled === true }))
        }, 'toggle')
      }

      const toggleEnabled = next => {
        if (draft === null) return
        if (!next) {
          setConfirming(false)
          applyEnabled(false)
          return
        }
        if (draft.action === 'shutdown' || draft.action === 'hibernate') {
          setConfirming(true)
          return
        }
        applyEnabled(true)
      }

      const cancel = async () => {
        setPending('cancel')
        setNotice(null)
        setCancelError('')
        try {
          const result = await api('/cancel', { method: 'POST' })
          setNotice({ tone: 'ok', text: result?.cancelled ? t('cancelDone') : t('cancelNothing') })
          reload()
        } catch (failure) {
          setCancelError(t('countdown.cancelFailed'))
          setNotice({ tone: 'bad', text: fill(t('error.cancel'), { detail: String(failure?.message ?? failure) }) })
        } finally {
          setPending('')
        }
      }

      const dryRun = async () => {
        setPending('test')
        setNotice(null)
        try {
          await api('/test', { method: 'POST' })
          setNotice({ tone: 'ok', text: t('testStarted') })
          reload()
        } catch (failure) {
          setNotice({ tone: 'bad', text: fill(t('error.test'), { detail: String(failure?.message ?? failure) }) })
        } finally {
          setPending('')
        }
      }

      const hint = triggerHint(t, state, now)
      const canCancel = state !== undefined && state !== null
        && (state.armed || state.phase === 'countdown' || state.phase === 'test')
      const confirmSummary = summaryLine(t, draft)
      const dotTone = state === undefined || state === null
        ? ''
        : state.phase === 'countdown' || state.phase === 'test' || state.phase === 'executing'
          ? 'count'
          : (state.runningAgents + state.runningJobs) > 0 ? 'busy' : state.enabled ? 'on' : ''

      const triggerLabel = live
        ? `${t('panel.title')} — ${hint}`
        : t('panel.title')

      /** Open the non-looping hour/minute picker for one field. */
      const openTimeField = (which, event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const width = 200
        const height = 250
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
        const top = rect.bottom + 6 + height <= window.innerHeight - 8
          ? rect.bottom + 6
          : Math.max(8, rect.top - height - 6)
        setPicker(current => (current !== null && current.which === which ? null : { which, left, top }))
      }

      return h('div', { ref: rootRef, className: wide ? 'psb-layer' : 'psb-layer psb-rail' },
        open && anchor !== null
          ? h('section', {
            ref: panelRef,
            tabIndex: -1,
            className: 'psb-panel',
            style: { left: anchor.left, width: anchor.width, bottom: anchor.bottom, maxHeight: anchor.maxHeight },
            role: 'dialog',
            'aria-modal': 'false',
            'aria-label': t('panel.title'),
          },
          h('header', { className: 'psb-header' },
            h(PowerIcon, { size: 16 }),
            h('span', { className: 'psb-title' }, t('panel.title')),
            h('button', {
              type: 'button', className: 'psb-close', 'aria-label': t('panel.close'),
              onClick: () => { setOpen(false); triggerRef.current?.focus() },
            }, h(CloseIcon))),
          h('div', { className: 'psb-body' },
            h('div', { className: 'psb-status' },
              h('span', { className: `psb-dot ${dotTone}` }),
              h('div', { className: 'psb-statusText' },
                h('div', { className: 'psb-statusTitle' }, view.title),
                (view.lines ?? []).map((line, index) => h('div', { key: index, className: 'psb-line' }, line))),
              h('div', { className: 'psb-statusSwitch' },
                h('span', { className: 'psb-note' }, t('toggle.label')),
                h(Switch, {
                  checked: serverSettings?.enabled === true,
                  disabled: busy || data === null,
                  label: t('toggle.enabled'),
                  onChange: toggleEnabled,
                }))),

            confirming
              ? h('div', { className: 'psb-confirm' },
                h('div', { className: 'psb-labelText' }, t('confirm.title')),
                h('div', { className: 'psb-note' }, fill(t('confirm.body'), { summary: confirmSummary })),
                h('div', { className: 'psb-actions' },
                  h('button', {
                    type: 'button', className: 'psb-btn primary', disabled: busy,
                    onClick: () => { setConfirming(false); applyEnabled(true) },
                  }, t('confirm.ok')),
                  h('button', {
                    type: 'button', className: 'psb-btn', disabled: busy,
                    onClick: () => setConfirming(false),
                  }, t('confirm.cancel'))))
              : null,

            counting
              ? h('div', { className: 'psb-countdown', role: 'group', 'aria-label': t('countdown.title') },
                h('span', { className: 'psb-bigTime' }, fmtClock(secondsLeft(state, now))),
                h('div', { className: 'psb-countdownText' },
                  h('div', null, state.phase === 'test' ? t('status.test') : fill(t('countdown.text'), { action: t(`action.${state.action}`) })),
                  h('div', null, cancelError !== '' ? t('countdown.cancelFailed') : t('countdown.detail'))),
                h('button', {
                  type: 'button', className: 'psb-btn danger', disabled: busy, onClick: cancel,
                }, t('countdown.cancel')))
              : null,

            h('div', { className: 'psb-rows' },
              h('div', { className: 'psb-groupTitle' }, t('section.trigger')),
              h(Row, { label: t('section.action'), hint: t('section.actionHint') },
                h('select', {
                  className: 'psb-select',
                  'aria-label': t('section.action'),
                  value: draft?.action ?? 'shutdown',
                  disabled: busy || draft === null || state?.phase === 'countdown',
                  onChange: event => edit('action', event.target.value),
                }, ACTIONS.map(value => h('option', { key: value, value }, t(`action.${value}`))))),
              h(Row, { label: t('section.idle'), hint: t('section.idleHint') },
                h('input', {
                  className: 'psb-input num', type: 'text', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 4,
                  'aria-label': t('section.idle'),
                  value: draft?.idleMinutes ?? 10, disabled: busy || draft === null,
                  onChange: event => editNumeric(event, 0, 720, value => edit('idleMinutes', value)),
                }),
                h('span', { className: 'psb-suffix' }, t('unit.minute'))),
              h(Row, { label: t('section.countdown'), hint: t('section.countdownHint') },
                h('input', {
                  className: 'psb-input num', type: 'text', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 4,
                  'aria-label': t('section.countdown'),
                  value: draft?.countdownSeconds ?? 60, disabled: busy || draft === null,
                  onChange: event => editNumeric(event, 0, 1800, value => edit('countdownSeconds', value)),
                }),
                h('span', { className: 'psb-suffix' }, t('unit.second'))),
              h(Row, { label: t('section.window'), hint: t('section.windowHint') },
                h('button', {
                  type: 'button',
                  className: 'psb-timeField',
                  'data-psb-timefield': 'start',
                  'aria-label': `${t('section.window')} — ${t('section.windowStart')}`,
                  'data-empty': draft?.windowStart ? undefined : true,
                  title: t('time.pick'),
                  disabled: busy || draft === null,
                  onClick: event => openTimeField('start', event),
                }, draft?.windowStart || t('time.none')),
                h('span', { className: 'psb-suffix' }, '–'),
                h('button', {
                  type: 'button',
                  className: 'psb-timeField',
                  'data-psb-timefield': 'end',
                  'aria-label': `${t('section.window')} — ${t('section.windowEnd')}`,
                  'data-empty': draft?.windowEnd ? undefined : true,
                  title: t('time.pick'),
                  disabled: busy || draft === null,
                  onClick: event => openTimeField('end', event),
                }, draft?.windowEnd || t('time.none'))),
              h(Row, { label: t('section.countJobs'), hint: t('section.countJobsHint') },
                h(Switch, {
                  checked: draft?.countJobs === true,
                  disabled: busy || draft === null,
                  label: t('section.countJobs'),
                  onChange: next => edit('countJobs', next),
                }))),

            h('div', { className: 'psb-actions' },
              h('button', {
                type: 'button', className: 'psb-btn primary', disabled: busy || !dirty || state?.phase === 'countdown', onClick: save,
              }, pending === 'save' ? t('saving') : t('save')),
              h('button', {
                type: 'button', className: 'psb-btn', disabled: busy || counting || state?.phase === 'executing', onClick: dryRun,
              }, pending === 'test' ? t('testing') : t('test')),
              canCancel
                ? h('button', {
                  type: 'button', className: 'psb-btn danger', disabled: busy || state.phase === 'executing', onClick: cancel,
                }, t('cancel'))
                : null,
              h('button', {
                type: 'button', className: 'psb-btn', disabled: busy, onClick: reloadAll,
              }, t('refresh'))),

            dirty ? h('div', { className: 'psb-note warn' }, t('unsaved')) : null,
            notice ? h('div', { className: `psb-note ${notice.tone === 'bad' ? 'bad' : 'ok'}`, role: 'status' }, notice.text) : null,
            error
              ? h('div', { className: 'psb-note bad' },
                fill(t('error.read'), { detail: error }),
                h('span', { className: 'psb-note' }, ` ${t('error.hint')}`))
              : null,

            h('div', { className: 'psb-tips' },
              h('div', { className: 'psb-note' }, t('hint.cancel')),
              h('div', { className: 'psb-note' }, t('hint.scopeOnly')),
              h('div', { className: 'psb-note' }, t('hint.scope')))))
          : null,
        open && picker !== null
          ? h(TimePopover, {
            which: picker.which,
            left: picker.left,
            top: picker.top,
            value: picker.which === 'start' ? (draft?.windowStart ?? '') : (draft?.windowEnd ?? ''),
            t,
            onChange: next => edit(picker.which === 'start' ? 'windowStart' : 'windowEnd', next),
            onClose: () => setPicker(null),
          })
          : null,
        h('button', {
          ref: triggerRef,
          type: 'button',
          className: 'psb-trigger',
          'data-psb-trigger': 'true',
          'data-rail': wide ? 'false' : 'true',
          'data-active': (open || live) ? true : undefined,
          'aria-label': triggerLabel,
          'aria-expanded': open,
          'aria-haspopup': 'dialog',
          title: live ? `${t('panel.title')} — ${hint}` : (hint === '' ? undefined : hint),
          onClick: () => setOpen(value => !value),
        },
        h(PowerIcon, { size: wide ? 16 : 18 }),
        wide ? h('span', { className: 'psb-label' }, t('trigger.label')) : null,
        wide
          ? h('span', { className: `psb-hint${live ? ' is-live' : ''}` },
            state?.enabled ? h('span', { className: `psb-dot ${dotTone}` }) : null,
            hint)
          : (state?.enabled ? h('span', { className: `psb-dot ${dotTone}` }) : null)))
    }

    /** Where the sidebar footer currently is: wide, rail, or invisible. */
    function footerCoverage() {
      const element = document.querySelector('[data-psb-trigger]')
      if (element === null) return 'hidden'
      const rect = element.getBoundingClientRect()
      if (rect.width <= 1 || rect.height <= 1) return 'hidden'
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return 'hidden'
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return 'hidden'
      return element.getAttribute('data-rail') === 'true' ? 'rail' : 'wide'
    }

    /**
     * Safety net for the countdown when the sidebar footer cannot show the
     * time: the 56px rail, a collapsed Windows sidebar, or a hidden drawer.
     */
    function CountdownFallback({ t }) {
      const { data, reload } = useStatus(3000)
      const [now, setNow] = useState(Date.now())
      const [error, setError] = useState('')
      const state = data?.state
      const active = state !== undefined && state !== null
        && (state.phase === 'countdown' || state.phase === 'test' || state.phase === 'executing')
      const show = active && footerCoverage() !== 'wide'

      useEffect(() => {
        if (!show) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 500)
        return () => clearInterval(timer)
      }, [show])

      useEffect(() => {
        if (!active) setError('')
      }, [active])

      const cancel = async () => {
        try {
          await api('/cancel', { method: 'POST' })
          setError('')
          await reload()
        } catch {
          setError(t('countdown.cancelFailed'))
        }
      }

      if (!show) return null
      const executing = state.phase === 'executing'
      const left = Math.max(0, Math.ceil(((state.countdownEndsAt ?? now) - now) / 1000))
      const label = executing
        ? t('trigger.executing')
        : state.phase === 'test'
          ? fill(t('trigger.test'), { time: fmtClock(left) })
          : `${fmtClock(left)} · ${t(`action.${state.action}`)}`
      return h('div', { className: 'psb-pill' },
        h('div', { className: 'psb-pillCard', role: 'status', 'aria-label': label },
          h('span', { className: 'psb-dot count' }),
          h('span', { className: 'psb-pillText' }, label),
          error !== '' ? h('span', { className: 'psb-pillError' }, error) : null,
          executing
            ? null
            : h('button', { type: 'button', className: 'psb-btn', onClick: cancel }, t('countdown.cancel'))))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'power-saver: dictionaries')
        ctx.effect(() => {
          const element = document.createElement('style')
          element.setAttribute('data-plugin', 'dsh-power-saver')
          element.textContent = CSS
          document.head.appendChild(element)
          return () => element.remove()
        }, 'power-saver: styles')
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'power-saver',
          locale: NS,
          label: () => t('trigger.label'),
        }, props => h(PowerSaverSidebar, { ...props, t })))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'power-saver.countdown',
          order: 100,
        }, () => h(CountdownFallback, { t })))
      },
    }
  },
})
