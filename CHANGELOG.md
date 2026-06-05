# Changelog

## [0.3.0](https://github.com/khiops/termora/compare/v0.2.9...v0.3.0) (2026-06-05)


### Features

* **hub:** per-host launch profiles from remote agent HELLO shells + SSH fallback ([c34f3c6](https://github.com/khiops/termora/commit/c34f3c620ad03d8aa8d751a1f96a266616168734))


### Bug Fixes

* **ci:** use --target for cross-compile — aarch64 agent was built as x86_64 ([9c6a506](https://github.com/khiops/termora/commit/9c6a5064cefc265d0a9a4ff14c66e9da5ff11d62))
* **web,hub:** multi-client channel sync + SSH reconnect for encrypted keys ([930a299](https://github.com/khiops/termora/commit/930a299ce5f2fc906594e1c91e4354a531f8507e))
* **web:** write-lock takeover now visible on observer clients ([81c2c0a](https://github.com/khiops/termora/commit/81c2c0adf8bbc39babdd6153d26cd8ace8b6358e))


### Performance Improvements

* **hub:** stream log-search reads instead of slurping whole file ([80f8db3](https://github.com/khiops/termora/commit/80f8db39038ee362fc3d2e037017858163594e08))

## [0.2.0](https://github.com/khiops/termora/compare/v0.1.0...v0.2.0) (2026-04-03)


### Features

* **all:** build versioning — /api/health version field + About modal ([c49eb3b](https://github.com/khiops/termora/commit/c49eb3b0e8f746656aedddddfd0d31b5a597130e))
