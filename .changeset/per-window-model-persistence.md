---
"@kenkaiiii/ggcoder": patch
---

Persist model + thinking selection per-project (per window) across app restarts.

Previously every window's sidecar wrote its model choice to a single shared
`defaultModel`/`defaultProvider` slot in `~/.gg/settings.json`, so switching a
model in one window clobbered the selection for all others — and on restart
every window defaulted to the last-written model (or fell back to the provider
default when that provider wasn't logged in). Model + thinking preferences are
now stored keyed by project cwd in `~/.gg/gg-app.json` and read first on boot;
the global slot is kept only as a fallback for never-opened projects.
