# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog 2.0.0](https://keepachangelog.com/en/2.0.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html); on `0.y.z` anything may change.

## [Unreleased]

## [1.2.0] - 2026-07-23

### Added

- Inbound auth on the `/mcp` endpoint: a static `AUTH_SECRET` bearer for automation and Claude Code, and OAuth 2.0/PKCE with stateless HMAC tokens for the claude.ai connector.
- `AGENTS.md` install contract, `mcp.json` manifest, and `verify.sh`, an adversarial check that asserts an unauthenticated request is refused.
- `docs/ARCHITECTURE.md` and `docs/RUNBOOK.md`.

### Changed

- README documents the `AUTH_SECRET` setup step and both auth paths.

## [1.1.0] - 2026-05-13

### Added

- `grok_image_generate`, `grok_image_understand`, `grok_image_edit`, `grok_video_generate`, `grok_structured_output`, `grok_reasoning`.

### Changed

- Shared `xaiFetch` helper and separate response extractors for text, image, and video. All tools remain stateless.

## [1.0.0] - 2026-05-11

### Added

- Initial release: `x_search`, `grok_web_search`, `grok_chat` as MCP tools over a Cloudflare Worker. Stateless, no Durable Objects.
