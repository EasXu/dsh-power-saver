<p align="center">
  <img src="icon.svg" width="72" height="72" alt="dsh-power-saver icon">
</p>

<h1 align="center">dsh-power-saver</h1>

<p align="center">
  Shut down, hibernate, or lock this PC once every DSH project has finished.<br>
  <a href="README.zh.md">中文说明</a> ·
  <a href="https://github.com/EasXu/dsh-power-saver/issues">Issues</a> ·
  <a href="LICENSE">MIT License</a>
</p>

A plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) that watches every DSH session and background job, waits until all work has been idle for a configurable period, shows a cancellable countdown, and then performs one power action: **shut down**, **hibernate**, **lock the screen**, or **do nothing** (a safe dry run).

It lives exactly where you need it: a single **Auto power-off** entry at the foot of the left sidebar, beside Settings. Click it to configure; when a countdown starts, the remaining time is shown right there.

## Why

Long jobs often run before bed or while you are away. You do not want to keep watching the screen, and you do not want the machine to stay on all night either. dsh-power-saver turns "every session has finished" into a safe, cancellable power action.

## Features

- **Sidebar-native** — one entry in the left sidebar footer (`sidebar.footer.action`) and an anchored settings panel; no separate settings page to hunt for.
- **Work-aware** — only arms after it has observed a running DSH session or background job, so simply enabling it never powers off an idle machine.
- **All projects, not just one** — a session, a subagent, a workflow child, or a background job that is still running keeps the timer waiting.
- **Countdown with cancel** — a configurable grace period; the sidebar row shows `mm:ss`, the panel shows a large timer, and the countdown can be cancelled from either place. Starting any new DSH work also cancels it.
- **Active window** — optional start/end time (for example `22:00–05:00`, including across midnight); outside the window the run is skipped instead of powering off.
- **Safe defaults** — the feature is off by default; enabling a destructive action asks for confirmation that names the exact plan; a dry run exercises the whole flow without touching the system.
- **Honest failure reporting** — if hibernation is not enabled, the panel shows the system's error instead of failing silently.
- **Local only** — no network access, no telemetry. State is served on loopback `/api/power-saver/*` behind the same trust fence as DSH's own API, and settings live in `$DSH_HOME/power-saver.json`.

## Requirements

- DSH with the `sidebar.footer.action` slot (current Desktop and Web builds).
- Windows 10/11 for the primary use case. macOS and Linux use best-effort system commands:
  - Windows: `shutdown.exe /s`, `shutdown.exe /h`, `rundll32 user32.dll,LockWorkStation`
  - macOS: `osascript`, `pmset`
  - Linux: `systemctl`, `loginctl`
- Hibernation must be enabled on Windows (`powercfg /hibernate on` as administrator).
- No Node.js is required at runtime; the plugin has zero dependencies.

## Install

```sh
git clone https://github.com/EasXu/dsh-power-saver.git
```

Then, in DSH:

1. Open **Plugins** (left sidebar) → **Add plugin** → **Local directory**, and choose the cloned `dsh-power-saver` directory.
2. Make sure the bundle is enabled.
3. Open the **Auto power-off** entry at the bottom of the left sidebar.

Alternatively, ask a DSH agent to install it from the absolute directory with `plugin_manager install_bundle`. Installing from a local directory links the checkout, so `git pull` updates the installed plugin after a DSH restart.

## Usage

1. Click **Auto power-off** at the sidebar foot. The panel shows the current state and a one-line plan such as `Plan: shut down · all day · after 10 min idle, a 01:00 countdown`.
2. Turn on the **Enable** switch. For **shut down** or **hibernate**, a confirmation appears first with the exact plan; for **lock** or **notify only**, it enables immediately.
3. Choose the action and timing:

| Setting | Default | Meaning |
|---|---|---|
| Action | shut down | `shut down`, `hibernate`, `lock the screen`, or `notify only` (dry run) |
| Idle wait | 10 min | How long every project must stay finished before the countdown starts. `0` starts it immediately (0–720 min) |
| Countdown | 60 s | Grace period before acting; cancel any time. `0` acts immediately (0–1800 s) |
| Active window | empty | Both fields empty = all day. If set, fill both; for a window across midnight, start later than end, e.g. `22:00–05:00` |
| Count background jobs | on | Running DSH background jobs also count as unfinished work |

4. Press **Save settings**. Toggling Enable saves immediately, including any unsaved edits in the panel.
5. Use **Dry run** to watch the countdown and cancellation without any system action.

### Countdown and cancel

- When a countdown starts, the sidebar row turns into the remaining `mm:ss`.
- Open the row to see the large timer, the action, and **Cancel**.
- If the sidebar is collapsed to a rail or hidden, a small countdown pill appears in the bottom-right corner as a safety net.
- Sending a message to any session (which starts a run) cancels the plan automatically.
- Quitting DSH, disabling the plugin, or unloading the bundle cancels it too.

### What happens at zero

1. Live session logs are flushed (up to 3 seconds) so the last events are durable.
2. The action captured when the countdown started is executed. Changing the action during a countdown cancels that countdown; it never silently switches to a different action.
3. The panel shows the outcome, including the system error when an action fails.

## How it works

- The Host half runs inside the DSH process. It tracks `agent/status` and `agent/disposed`, cross-checks `agents.list()` on a one-second clock, and optionally counts running `jobs.list()` entries.
- The first observed run arms the scheduler. After the last activity ends, the idle timer runs; when it expires inside the active window, the countdown begins.
- The browser half is a plain CommonJS client module: a `sidebar.footer.action` entry plus a `shell.overlay` fallback. It reads state from `/api/power-saver/status` and writes only through `/config`, `/cancel`, and `/test`.
- The settings file is written atomically to `$DSH_HOME/power-saver.json`.

## Limitations

- Only DSH sessions and DSH background jobs are counted. Builds, scripts, or terminals outside DSH are invisible to the plugin.
- The schedule lives inside the DSH process: quitting DSH cancels it. There is no OS-level persistent job.
- Shut down force-closes other applications, including unsaved work in them.
- Hibernation requires it to be enabled by the OS. On macOS the "hibernate" entry maps to `pmset sleepnow` and "lock" to display sleep, because those are the closest native commands.
- The active window is evaluated when the countdown would start; if the idle wait ends outside the window, that run is skipped and reported as skipped.

## Development

No dependencies, no build step.

```sh
node --check index.js
node --check client.js
npm test
```

Layout:

```
index.js              Host half: watcher, engine, HTTP routes, trust fence
client.js             Browser half: sidebar entry, panel, countdown surfaces
cordis.patch.yml      Bundle patch inserting the plugin row
package.json          Bundle manifest (dsh.bundle + dsh.client)
locale/{en,zh}.json   Plugin Manager title and description
test/engine.test.mjs  Pure Node tests for the Host state machine
icon.svg              Original plugin icon
```

The Host engine is exported through `__test` so the state machine can be exercised with a fake clock and fake services. See `test/engine.test.mjs`.

## Privacy

No network requests. No analytics. Configuration stays in `$DSH_HOME/power-saver.json`; the UI talks to the local Host only.

## License

[MIT](LICENSE) © 2026 EastonXu
