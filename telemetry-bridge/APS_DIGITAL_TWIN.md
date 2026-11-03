# APS digital twin

The site's **Digital Twin** page (`#twin`) shows the CubeSat STEP assembly in Autodesk Viewer v7. The model is translated to SVF2 by the APS Model Derivative service.

## Bridge routes (behind the existing `/telemetry/` Apache prefix)

| Route | Returns |
|---|---|
| `GET /aps/model` | `{ enabled, urn, bucket }`. The URN is not secret. |
| `GET /aps/token` | A 2-legged token scoped to `viewables:read` only, cached until 60 s before expiry. |

Both routes use the same session gate as the other read routes: a viewer or operator session when JWT is enabled.

## Environment (bridge only, never in the repo)

```
APS_CLIENT_ID=...
APS_CLIENT_SECRET=...
APS_BUCKET=cubesat-twin-xxxxxxxx
APS_MODEL_URN=<base64url URN>
```

Put these in a root-owned `chmod 600` EnvironmentFile and reference it from the `cubesat-telemetry` systemd unit.

## Content Security Policy

If the site sends a CSP, allow `https://developer.api.autodesk.com` and `https://cdn.derivative.autodesk.com` for `script-src`, `style-src`, `connect-src`, `img-src` and `font-src`. Also allow `worker-src blob:`.

## Updating the model

Run the steps below with an admin token (scopes `data:read data:write data:create bucket:create bucket:read`). Then update `APS_MODEL_URN` and restart the bridge.

1. Upload the new STEP with `GET`, then `PUT` to S3, then `POST` to `/oss/v2/buckets/{bucket}/objects/{name}/signeds3upload`.
2. Start an SVF2 job: `POST /modelderivative/v2/designdata/job`.
3. Poll the manifest until its status is `success`.

## Webhooks (optional)

The `extraction.finished` event (system `derivative`) can notify a public HTTPS callback when a translation finishes. This is not wired up: the bridge would need a public route that verifies the webhook signature. Polling the manifest is enough for occasional model updates.
