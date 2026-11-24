English | [简体中文](CHANGELOG.zh.md)

# Changelog

## 0.3.0 — 2026-11-24

- The active window now gates the whole feature: outside it nothing is detected, timed, armed, or executed.
- Only a run observed starting inside the window arms the scheduler. A project already running when the window begins no longer counts, even if it ends inside the window.
- An armed plan or running countdown is cancelled when the window ends.
- The sidebar panel is more compact: per-field hint paragraphs are gone, leaving one short window hint, one safety line, and one footer line.

## 0.2.0 — 2026-11-19

- Moved the entry point into the left sidebar footer (`sidebar.footer.action`); the separate Settings page is gone.
- Added an anchored settings panel with status, plan summary, confirmation before enabling a destructive action, and inline errors.
- Countdown now appears in the sidebar row and the panel, with a bottom-right fallback pill when the sidebar is a rail or hidden.
- Replaced native time inputs with a non-looping hour/minute picker; clicking a field no longer selects digits.
- Numeric fields are digit-only, reject negatives, strip leading zeros, and clamp to their documented ranges.
- The action is captured when a countdown starts; changing the action cancels that countdown. A dry run is refused while a real countdown runs.
- Clearer idle-wait status copy and better placement in narrow/drawer layouts.

## 0.1.0 — 2026-11-15

- Initial release: host watcher for sessions and background jobs, idle wait, configurable countdown, shutdown / hibernate / lock / notify-only actions, active window, local trust-fenced API, settings file under `$DSH_HOME`.
