import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { googleClient, applicationGoogleClient } from './google-client.mjs';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export class GoogleAuth {
  constructor(secrets, { fetchImpl = fetch, loadClient = applicationGoogleClient } = {}) {
    this.secrets = secrets;
    this.fetch = fetchImpl;
    this.loadClient = loadClient;
    this.access = null;
    this.pending = null;
    this.result = null;
  }
  async configure(value) {
    const client = googleClient(value);
    const previous = await this.secrets.read();
    await this.secrets.write({
      client,
      clientSource: 'local',
    });
    this.access = null;
    this.cancel();
    this.result = null;
    return { configured: true, reauthorizationRequired: !!previous.refresh_token };
  }
  async status() {
    const value = await this.secrets.read();
    const client = value.client || (await this.loadClient());
    return {
      configured: !!client?.client_id,
      connected: !!value.refresh_token,
      clientId: client?.client_id || '',
      configurationSource:
        value.clientSource === 'local' ? 'local' : client ? 'application' : 'missing',
      account: value.refresh_token ? value.account || null : null,
      pending: !!this.pending,
      result: this.result,
    };
  }
  cancel() {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.server.close();
      this.pending = null;
    }
  }
  async begin() {
    const previous = await this.secrets.read(),
      client = previous.client || (await this.loadClient()),
      clientSource = previous.clientSource || 'application';
    if (!client)
      throw new Error(
        '此开发包尚未配置 Google 登录。请由应用开发者配置一次 OAuth 客户端后重新打包；普通用户只需登录自己的 Google 账号。',
      );
    this.cancel();
    this.result = null;
    const verifier = randomBytes(48).toString('base64url'),
      state = randomBytes(32).toString('base64url');
    const server = createServer(async (req, res) => {
      const port = server.address()?.port;
      if (req.headers.host !== `127.0.0.1:${port}`) {
        res.writeHead(400);
        res.end('Invalid host');
        return;
      }
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== '/oauth2/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const supplied = Buffer.from(url.searchParams.get('state') || ''),
        expected = Buffer.from(state);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.writeHead(400);
        res.end('Invalid OAuth state');
        return;
      }
      try {
        if (url.searchParams.has('error')) throw new Error('Google 授权已取消或被拒绝。');
        const code = url.searchParams.get('code');
        if (!code || code.length > 4096) throw new Error('Google 授权响应无效。');
        const token = await this.exchange(
          new URLSearchParams({
            ...client,
            code,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: `http://127.0.0.1:${port}/oauth2/callback`,
          }),
        );
        if (!token.refresh_token) throw new Error('未取得离线授权，请重新连接 Google Drive。');
        if (typeof token.access_token !== 'string' || !Number.isFinite(token.expires_in))
          throw new Error('Google 令牌响应无效。');
        const response = await this.fetch(
          'https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,displayName)',
          {
            headers: { Authorization: `Bearer ${token.access_token}` },
            redirect: 'error',
            signal: AbortSignal.timeout(30000),
          },
        );
        if (!response.ok) throw new Error('无法确认当前 Google 账号，请重新登录。');
        const { user } = await response.json();
        if (
          typeof user?.permissionId !== 'string' ||
          !user.permissionId ||
          user.permissionId.length > 200
        )
          throw new Error('Google 账号信息不完整，请重新登录。');
        const account = {
          id: user.permissionId,
          email: user.emailAddress || '',
          name: user.displayName || '',
        };
        await this.secrets.write({
          client,
          clientSource,
          refresh_token: token.refresh_token,
          account,
        });
        this.cache(token, this.sessionKey(client, token.refresh_token));
        this.result = {
          ok: true,
          message: `已登录 ${account.email || account.name || '你的 Google 账号'}。资料仅同步到这个账号的 Drive；请选择或创建资料库。`,
        };
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        });
        res.end(
          '<meta charset="utf-8"><h1>Google Drive 已连接</h1><p>可以关闭此页，返回 PKM Nexus。</p>',
        );
      } catch (error) {
        this.result = { ok: false, message: error.message };
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('授权未完成。请返回 PKM Nexus 查看状态。');
      } finally {
        this.cancel();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const timer = setTimeout(() => {
      this.result = { ok: false, message: '授权超时，请重新连接。' };
      this.cancel();
    }, 180000);
    timer.unref();
    this.pending = { server, timer };
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: `http://127.0.0.1:${server.address().port}/oauth2/callback`,
      response_type: 'code',
      scope: DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent select_account',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  }
  sessionKey(client, refreshToken) {
    return createHash('sha256')
      .update(JSON.stringify([client.client_id, refreshToken]))
      .digest('hex');
  }
  cache(token, sessionKey) {
    if (
      typeof token.access_token !== 'string' ||
      !token.access_token ||
      !Number.isFinite(token.expires_in)
    )
      throw new Error('Google 令牌响应无效。');
    this.access = {
      token: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000 - 60000,
      sessionKey,
    };
  }
  async exchange(body) {
    const response = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(
        response.status === 400
          ? 'Google 授权失效或客户端配置不正确，请重新授权。'
          : `Google 授权服务暂时不可用（${response.status}）。`,
      );
    return response.json();
  }
  async token({ expectedAccountId } = {}) {
    const value = await this.secrets.read(),
      { client, refresh_token } = value;
    if (!client || !refresh_token) throw new Error('请先连接 Google Drive。');
    if (expectedAccountId && value.account?.id !== expectedAccountId)
      throw new Error(
        'Google 账号已变化，已停止本次云端读写。请重新登录原账号或选择另一个本地资料库。',
      );
    const sessionKey = this.sessionKey(client, refresh_token);
    if (this.access?.sessionKey === sessionKey && this.access.expiresAt > Date.now())
      return this.access.token;
    const token = await this.exchange(
      new URLSearchParams({ ...client, refresh_token, grant_type: 'refresh_token' }),
    );
    const current = await this.secrets.read();
    if (!current.client || this.sessionKey(current.client, current.refresh_token) !== sessionKey)
      throw new Error('Google 授权已变化，请重新执行操作。');
    this.cache(token, this.sessionKey(client, token.refresh_token || refresh_token));
    if (token.refresh_token && token.refresh_token !== refresh_token)
      await this.secrets.write({ ...value, refresh_token: token.refresh_token });
    return this.access.token;
  }
  async disconnect() {
    this.cancel();
    const value = await this.secrets.read();
    if (value.refresh_token) {
      const response = await this.fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: value.refresh_token }).toString(),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
      if (!response.ok && response.status !== 400)
        throw new Error('暂时无法撤销 Google 授权，请联网后重试。');
    }
    this.access = null;
    await this.secrets.write(
      value.client ? { client: value.client, clientSource: value.clientSource } : {},
    );
    this.result = null;
  }
}
