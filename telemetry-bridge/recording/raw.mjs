// Preserve binary/hex bytes exactly. Never archive the JSON transport's shared credential.
export function archivePayload(message) {
  try {
    const value = JSON.parse(message.toString('utf8'));
    if (value && typeof value === 'object' && Object.hasOwn(value, 'auth_token')) {
      delete value.auth_token;
      return { rawBase64: Buffer.from(JSON.stringify(value)).toString('base64'), redacted: true };
    }
  } catch {}
  return { rawBase64: message.toString('base64'), redacted: false };
}
