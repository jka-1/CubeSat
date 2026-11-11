# OrbitalAddress — Knight EPS

Architecture:
- ESP32-S3 sends UDP telemetry to a Node.js backend.
- Apache serves the dashboard; browser receives SSE telemetry.
- Authenticated operator commands reach the ESP32 through the backend.

Coding rules:
- Only inspect and edit files relevant to the request.
- Prefer minimal changes; preserve existing architecture.
- Reuse existing dependencies and functions.
- Never modify unrelated functionality.
- Preserve telemetry, SSE, hardware command behavior, and security.
- Run focused tests after changes.
- Do not deploy or change production configuration.
- Keep responses concise: files changed, tests, unresolved issues.
- Do not use subagents unless explicitly requested.
- Notify me if changes warrant the updating of this file to include more rules.