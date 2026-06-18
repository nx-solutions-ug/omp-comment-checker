# 1.0.0 (2026-06-18)


### Bug Fixes

* add @semantic-release/npm plugin to publish to npm ([07fe727](https://github.com/nx-solutions-ug/omp-comment-checker/commit/07fe727146be581df0e0622b2a4cb55b4e36bf6e))
* **build:** restore @types/node, @mariozechner/pi-ai devDeps; repair semver tag ([2c9f903](https://github.com/nx-solutions-ug/omp-comment-checker/commit/2c9f903164001a84c9e602d4179b38da6c11b6b0))
* **cli:** preserve timeout reason after truncation ([b51fb51](https://github.com/nx-solutions-ug/omp-comment-checker/commit/b51fb51dc3373945a606f842cd45126807b4d6e7))
* **cli:** preserve UTF-8 when truncating output ([ff5b7cc](https://github.com/nx-solutions-ug/omp-comment-checker/commit/ff5b7cc6834214a657a3429a8a15b03df7fd3ff4))
* **cli:** resolve comment checker package binary ([caa3648](https://github.com/nx-solutions-ug/omp-comment-checker/commit/caa364815a755591af73251f6ec8350977752e0a))
* **cli:** time out hanging checker processes ([622ea45](https://github.com/nx-solutions-ug/omp-comment-checker/commit/622ea457b63f4d8b0475eda3de06a475edbe53ca))
* hide comment checker warning widget ([5bfe1d0](https://github.com/nx-solutions-ug/omp-comment-checker/commit/5bfe1d0981c46d7af456c0a3352592f69b92e18d))
* **omp:** preserve this-binding when calling host API methods ([c4fde44](https://github.com/nx-solutions-ug/omp-comment-checker/commit/c4fde4469f51d24b3f6067df8690c77607ef594d))
* quiet comment checker widget ([e24257b](https://github.com/nx-solutions-ug/omp-comment-checker/commit/e24257bbb24b33ffc1c542c3fc67cfd09f96cc76))


### Features

* add pi comment checker extension ([e669c6e](https://github.com/nx-solutions-ug/omp-comment-checker/commit/e669c6eefd07f9fb925f1073fa75c400749bc520))
* **omp:** retarget at oh-my-pi with self-heal loop ([a02f1e7](https://github.com/nx-solutions-ug/omp-comment-checker/commit/a02f1e7c308efa2e43d49f8e34a861f141f9dc5b))
* publish as @chronova/omp-comment-checker ([3f73fa5](https://github.com/nx-solutions-ug/omp-comment-checker/commit/3f73fa588481e57c53d4a6758814f291f7f53fe7))


### Performance Improvements

* **cli:** bound checker process output ([9f5a11a](https://github.com/nx-solutions-ug/omp-comment-checker/commit/9f5a11a8a71c9ffaeb779e4299599750d1d187bf))

# 1.0.0 (2026-06-18)


### Bug Fixes

* **build:** restore @types/node, @mariozechner/pi-ai devDeps; repair semver tag ([2c9f903](https://github.com/nx-solutions-ug/omp-comment-checker/commit/2c9f903164001a84c9e602d4179b38da6c11b6b0))
* **cli:** preserve timeout reason after truncation ([b51fb51](https://github.com/nx-solutions-ug/omp-comment-checker/commit/b51fb51dc3373945a606f842cd45126807b4d6e7))
* **cli:** preserve UTF-8 when truncating output ([ff5b7cc](https://github.com/nx-solutions-ug/omp-comment-checker/commit/ff5b7cc6834214a657a3429a8a15b03df7fd3ff4))
* **cli:** resolve comment checker package binary ([caa3648](https://github.com/nx-solutions-ug/omp-comment-checker/commit/caa364815a755591af73251f6ec8350977752e0a))
* **cli:** time out hanging checker processes ([622ea45](https://github.com/nx-solutions-ug/omp-comment-checker/commit/622ea457b63f4d8b0475eda3de06a475edbe53ca))
* hide comment checker warning widget ([5bfe1d0](https://github.com/nx-solutions-ug/omp-comment-checker/commit/5bfe1d0981c46d7af456c0a3352592f69b92e18d))
* **omp:** preserve this-binding when calling host API methods ([c4fde44](https://github.com/nx-solutions-ug/omp-comment-checker/commit/c4fde4469f51d24b3f6067df8690c77607ef594d))
* quiet comment checker widget ([e24257b](https://github.com/nx-solutions-ug/omp-comment-checker/commit/e24257bbb24b33ffc1c542c3fc67cfd09f96cc76))


### Features

* add pi comment checker extension ([e669c6e](https://github.com/nx-solutions-ug/omp-comment-checker/commit/e669c6eefd07f9fb925f1073fa75c400749bc520))
* **omp:** retarget at oh-my-pi with self-heal loop ([a02f1e7](https://github.com/nx-solutions-ug/omp-comment-checker/commit/a02f1e7c308efa2e43d49f8e34a861f141f9dc5b))
* publish as @chronova/omp-comment-checker ([3f73fa5](https://github.com/nx-solutions-ug/omp-comment-checker/commit/3f73fa588481e57c53d4a6758814f291f7f53fe7))


### Performance Improvements

* **cli:** bound checker process output ([9f5a11a](https://github.com/nx-solutions-ug/omp-comment-checker/commit/9f5a11a8a71c9ffaeb779e4299599750d1d187bf))

# Changelog

## [0.2.0] - 2026-06-15

### Changed

- Retargeted at `@oh-my-pi/pi-coding-agent` (oh-my-pi, `can1357/oh-my-pi`).
  Package renamed to `omp-comment-checker`. `@oh-my-pi/pi-coding-agent` and
  the original `@mariozechner/pi-coding-agent` peer deps are both optional
  and detected at load time; the extension works under either runtime.
- Renamed the slash command to `/omp-comment-checker`.
- Widget is now visible in `warning` state under omp (lists offending
  files and preview lines), hidden under pi.
- Footer `setStatus` line surfaces the warning count under omp; no-op under pi.

### Added

- Omp edit-tool `details.perFileResults` support in `extractCommentCheckRequests`.
  Omp's `edit` tool runs in `hashline`, `patch`, `replace`, and
  `apply_patch` modes; all four are now extracted uniformly through
  `extractFromOmpEditDetails`.
- Self-heal loop: when a checker warning fires, the record is appended
  to the session via `pi.appendEntry("omp-comment-checker:warning", …)`.
  On the next `session_compact` event, any unfired warnings are
  re-injected as a `pi.sendMessage` custom message so the next LLM
  turn sees them in context. The store is cleared on `session_start`.
- `src/omp.ts` — `createOmpBackend(pi)` probes for omp-only API surface
  (`appendEntry`, `sendMessage`, `session_compact` listener,
  `ctx.ui.setStatus`) and returns an `OmpBackend` whose methods are
  no-ops on plain pi.
- `src/self-heal.ts` — `SelfHealStore` keyed by stable UUIDs.

### Fixed

- None.

## [0.1.0] - 2026-05-15

### Added

- Initial standalone `pi-comment-checker` extension.
- Post-mutation checks for `write`, `edit`, `multiedit`, and `apply_patch`.
- OMO-compatible `apply_patch` metadata support using `before` / `after` file content.
- Raw Codex patch fallback parsing for `apply_patch`.
- Above-editor TUI widget for loading, missing-binary, warning, and error states.
- `/comment-checker` status command.
