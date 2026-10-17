import { readFile } from 'node:fs/promises';

// This identifies the application. It must never contain a user's credentials.
export function googleClient(value) {
  const client = value?.installed || value;
  if (
    value?.web ||
    value?.type === 'service_account' ||
    ['refresh_token', 'access_token', 'private_key'].some((key) => value?.[key] || client?.[key]) ||
    typeof client?.client_id !== 'string' ||
    client.client_id.length > 400 ||
    !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(client.client_id) ||
    (client.client_secret !== undefined &&
      (typeof client.client_secret !== 'string' || client.client_secret.length > 1000))
  )
    throw new Error('需要 Google Cloud 的桌面应用 OAuth 客户端 JSON，不能使用用户令牌或服务账号。');
  return {
    client_id: client.client_id,
    ...(client.client_secret ? { client_secret: client.client_secret } : {}),
  };
}

export async function applicationGoogleClient() {
  let value;
  try {
    value = JSON.parse(await readFile(new URL('./google-oauth.json', import.meta.url), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return value ? googleClient(value) : null;
}
