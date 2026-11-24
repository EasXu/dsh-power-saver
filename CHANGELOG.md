English | [简体中文](CHANGELOG.zh.md)

# Changelog

## 0.3.6 — 2026-11-24

- Narrowed the sidebar panel from 400px to 340px. Field and button dimensions, alignment, centred content, and the action-menu width are unchanged.

## 0.3.5 — 2026-11-24

- The action menu now uses exactly the field's width and aligns with its left and right edges.

## 0.3.4 — 2026-11-24

- Centred the content of the aligned fields: the action label, and the number plus its unit, sit in the middle of their box like the time fields. The action chevron stays at the right edge.

## 0.3.3 — 2026-11-24

- Replaced the native action `<select>` with a theme-matched dropdown: the menu surface, rounded corners, hover and selected states now follow DSH tokens, and the native blue highlight is gone.
- The menu opens aligned to its field, focuses the current option, and closes on outside click, Escape, or selection.
- Renamed the no-op action to "No action" (仅提示) so it fits the aligned field label.

## 0.3.2 — 2026-11-24

- The action menu, idle field, and countdown field now use the same width as the end-time field and align vertically with it. The time row keeps its two equal fields.

## 0.3.1 — 2026-11-24

- All form controls share one right-aligned column: the action menu, number fields with inline units, time fields, and the background-jobs switch line up with the same height and width.
- Action buttons (save, dry run, cancel, reload) render at equal widths and heights, and no longer shift when status text appears.
- Removed the redundant "Trigger" section heading; a divider now separates the status area from the settings rows.

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
