import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export function createAuthService({ app, Innertube, UniversalCache, authRoot, text, rawImage, proxied, youtubePromise, memory }) {
  // OAuth2 is currently supported by YouTube.js only with the TV InnerTube client.
  // Each browser gets its own signed session id and its own persistent OAuth cache.
  // Never keep one global authenticated YouTube client: that would make every browser
  // on the server share the same Google/YouTube account.
  const AUTH_ROOT = authRoot;
  const SESSION_ROOT = `${AUTH_ROOT}/sessions`;
  const SESSION_COOKIE = 'wetube.sid';
  const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
  mkdirSync(SESSION_ROOT, { recursive: true });
  const SESSION_SECRET_FILE = `${AUTH_ROOT}/.session-secret`;
  let SESSION_SECRET = String(process.env.WETUBE_SESSION_SECRET || '').trim();
  if (!SESSION_SECRET) {
    try { SESSION_SECRET = readFileSync(SESSION_SECRET_FILE, 'utf8').trim(); } catch {}
    if (!SESSION_SECRET) { SESSION_SECRET = randomBytes(48).toString('base64url'); writeFileSync(SESSION_SECRET_FILE, `${SESSION_SECRET}\n`, { mode: 0o600 }); }
  }
  const authClients = new Map();
  const authInitPromises = new Map();
  const authFlowPromises = new Map();
  const authStates = new Map();
  const sessionCachePath = sid => `${SESSION_ROOT}/${sid}`;
  const defaultAuthState = () => ({ status: 'signed_out', userCode: '', verificationUrl: '', expiresAt: 0, account: null, error: '' });
  const getAuthState = sid => { if (!authStates.has(sid)) authStates.set(sid, defaultAuthState()); return authStates.get(sid); };
  const signSessionId = sid => createHmac('sha256', SESSION_SECRET).update(sid).digest('base64url');
  const signedSessionCookie = sid => `${sid}.${signSessionId(sid)}`;
  const validSessionId = sid => /^[a-f0-9]{64}$/.test(String(sid || ''));
  const verifySessionCookie = value => {
    const [sid, signature] = String(value || '').split('.');
    if (!validSessionId(sid) || !signature) return '';
    const expected = signSessionId(sid);
    if (signature.length !== expected.length) return '';
    try { return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? sid : ''; } catch { return ''; }
  };
  const readCookie = (header, name) => String(header || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
  const setSessionCookie = (res, sid) => res.set('Set-Cookie', `${SESSION_COOKIE}=${signedSessionCookie(sid)}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax`);
  const clearSessionCookie = res => res.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  
  app.use((req, res, next) => {
    let sid = verifySessionCookie(readCookie(req.headers.cookie, SESSION_COOKIE));
    if (!sid) { sid = randomBytes(32).toString('hex'); setSessionCookie(res, sid); }
    req.wetubeSessionId = sid;
    req.wetubeAuthState = getAuthState(sid);
    next();
  });
  
  async function ensureAuthClient(req) {
    const sid = req.wetubeSessionId;
    const existing = authClients.get(sid);
    if (existing) return existing;
    if (!authInitPromises.has(sid)) {
      const promise = (async () => {
        const cache = new UniversalCache(true, sessionCachePath(sid));
        const client = await Innertube.create({ cache, client_type: 'TVHTML5', retrieve_player: false, generate_session_locally: true, lang: 'ja', location: 'JP' });
        authClients.set(sid, client);
        client.session.on('auth-pending', data => {
          authStates.set(sid, { status: 'pending', userCode: data.user_code || '', verificationUrl: data.verification_url || 'https://www.youtube.com/activate', expiresAt: Date.now() + Number(data.expires_in || 900) * 1000, account: null, error: '' });
        });
        client.session.on('auth', ({ credentials }) => {
          authStates.set(sid, { status: 'signed_in', userCode: '', verificationUrl: '', expiresAt: 0, account: getAuthState(sid).account, error: '' });
          Promise.resolve().then(async () => {
            try { client.session.oauth.setTokens(credentials); await client.session.oauth.cacheCredentials(); } catch (error) { console.warn('OAuth credential cache:', error?.message || error); }
            await refreshAuthAccount(client, sid);
          });
        });
        client.session.on('update-credentials', async ({ credentials }) => {
          try { client.session.oauth.setTokens(credentials); await client.session.oauth.cacheCredentials(); } catch {}
        });
        // YouTube.js requires signIn() even when OAuth credentials are cached.
        const cachedCredentials = await cache.get('youtubei_oauth_credentials');
        if (cachedCredentials) {
          try {
            await client.session.signIn();
            if (client.session.logged_in) {
              authStates.set(sid, { ...getAuthState(sid), status: 'signed_in', error: '' });
              await refreshAuthAccount(client, sid);
            }
          } catch (error) {
            console.warn(`OAuth restore [${sid.slice(0, 8)}]:`, error?.message || error);
            try { await cache.remove('youtubei_oauth_credentials'); } catch {}
            authStates.set(sid, { ...getAuthState(sid), status: 'signed_out', account: null, error: '保存されたログイン情報を復元できませんでした。再ログインしてください。' });
          }
        }
        return client;
      })().finally(() => authInitPromises.delete(sid));
      authInitPromises.set(sid, promise);
    }
    return authInitPromises.get(sid);
  }
  
  async function refreshAuthAccount(client, sid) {
    if (!client?.session?.logged_in) return null;
    try {
      const info = await client.account.getInfo();
      const item = info?.contents?.contents?.find(entry => entry?.is_selected) || info?.contents?.contents?.[0];
      if (!item) throw new Error('AccountInfo did not contain an account item');
      const avatar = proxied(rawImage({ account_photo: item.account_photo }));
      const account = { name: text(item.account_name, 'YouTube'), handle: text(item.channel_handle, ''), avatar };
      authStates.set(sid, { ...getAuthState(sid), account });
      return account;
    } catch (error) {
      console.warn('OAuth account info unavailable:', error?.message || error);
      return null;
    }
  }
  
  const activeYouTube = async req => {
    const client = await ensureAuthClient(req);
    return client.session.logged_in ? client : youtubePromise;
  };

  async function accountClient(req) {
    const client = await ensureAuthClient(req);
    if (!client.session.logged_in) {
      const error = new Error('AUTH_REQUIRED');
      error.status = 401;
      throw error;
    }
    if (client.session.oauth.shouldRefreshToken?.()) {
      await client.session.oauth.refreshAccessToken();
      await client.session.oauth.cacheCredentials();
    }
    if (!client.session.logged_in) {
      const error = new Error('AUTH_REQUIRED');
      error.status = 401;
      throw error;
    }
    return client;
  }

  return {
    ensureAuthClient,
    refreshAuthAccount,
    activeYouTube,
    accountClient,
    getAuthState,
    clearSessionCookie,
    authClients,
    authStates,
    authFlowPromises
  };
}
