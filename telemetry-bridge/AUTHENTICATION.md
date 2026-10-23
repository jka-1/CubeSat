# JWT login — local milestone

This implementation is opt-in and has not been deployed. It adds short-lived JWT sessions for the website while preserving the command token as a separate control for hardware actions.

## Authorization model

| Account | Read telemetry/history | Start or stop runs | Change live mode / send commands |
|---|---:|---:|---:|
| Viewer | Yes | No | No |
| Operator | Yes | Yes | Yes, with the existing `X-Command-Token` too |

When JWT login is enabled, `/health`, `/latest`, `/events`, `/runs`, `/input`, `/live-mode` and `/command` require a valid session. The public site pages and `GET /auth/status` remain available so the browser can present login. `GET /healthz` exposes only process readiness and server time for local service checks. The legacy `ALLOW_UNAUTHENTICATED_COMMANDS` setting cannot bypass JWT login or the command token while JWT mode is active.

The JWT is stored only in an `HttpOnly`, `SameSite=Strict` cookie. Production cookies require HTTPS and include `Secure`. State-changing requests require both an operator session and an in-memory CSRF value tied to that session. JWT verification pins HS256 and validates the signature, issuer, audience, subject, role, ID, issued time and expiry. Logout revokes the server-side session and closes its telemetry streams; a bridge restart invalidates every existing session. Sessions default to 15 minutes and cannot exceed one hour.

The Windows I²C tool follows the same flow when JWT is enabled. Its cookie jar, password and CSRF value remain in process memory; only the non-secret username and bridge URL are saved. Its SSE readers share that in-memory cookie jar. The existing command token remains separate and is still required for hardware commands.

## Create a private account file

Keep the account file outside this repository and outside the public website. The account tool reads the password from standard input so it does not appear in process arguments or the shell history:

```bash
cd telemetry-bridge
read -rsp 'Account password: ' CUBESAT_ACCOUNT_PASSWORD; echo
printf '%s\n' "$CUBESAT_ACCOUNT_PASSWORD" | node tools/auth-user.mjs /absolute/private/path/auth.json jaden operator
unset CUBESAT_ACCOUNT_PASSWORD
```

Run the command again to add or replace an account. Usernames may contain letters, numbers, `.`, `_` and `-`; passwords must contain 12–256 characters. The generated file is mode 600 and contains a random signing key plus scrypt password hashes. Never commit or copy its contents into issue reports.

## Local configuration

Install locked dependencies with `npm ci`, then set:

```bash
export AUTH_ENABLED=true
export AUTH_CONFIG_PATH=/absolute/private/path/auth.json
export AUTH_ORIGIN=http://127.0.0.1:8090
export AUTH_ALLOW_LOCAL_HTTP=true
export AUTH_SESSION_SECONDS=900
export COMMAND_TOKEN='your-existing-private-command-token'
```

Local HTTP is accepted only when `AUTH_ALLOW_LOCAL_HTTP=true`, the configured origin is loopback, and the bridge itself binds to loopback. Remote use requires an exact HTTPS `AUTH_ORIGIN`; forwarded origin and client-IP headers are not trusted. The current Apache layout should use the public site origin, for example `https://itzjac.online`, because the browser reaches the API through `/telemetry/` on that origin.

Omit `AUTH_CONFIG_PATH` to retain the pre-login behavior during local compatibility work. Setting `AUTH_ENABLED=true` without a valid private configuration fails bridge startup. Account configuration is loaded only at startup; restart after adding or changing users. Keep `COMMAND_TOKEN` configured even if the legacy unauthenticated-command option was previously used.

## Deliberate limits

Sessions and revocations are held in memory for one bridge process. This is suitable for the current single-process, single-droplet design and deliberately invalidates sessions on restart. A multi-process deployment would need a shared session store. Login limits use the TCP peer address; behind the current local Apache proxy, users share the conservative ten-attempts-per-minute limit. Password reset, self-registration, refresh tokens and federated identity are outside this milestone.
