
import express from 'express';
import compression from 'compression';
import { randomUUID } from 'node:crypto';
import { Innertube, UniversalCache, YTNodes, Log } from 'youtubei.js';
import { createAuthService } from './src/auth.js';
import { memory, cached, userCached, eduParams, eduParamSources } from './src/cache.js';
import {
  youtubePromise, isImageHost, text, formatViewCount, bestThumbnail, rawImage, proxied,
  normalizeShort, collectShorts, normalizeVideo, collectVideos,
  collectPlaylists, collectChannels, normalizeFeedVideos, numericViews
} from './src/youtube/media.js';
import {
  executeVideoRating, executeChannelSubscription, walkRaw, accountLikedVideos, accountSubscribedChannels, normalizeAccountHistoryFeed, accountWatchHistoryFeed, nextAccountHistoryPage, accountWatchHistoryLatest, accountVideoRatingStatus, accountChannelSubscriptionStatus
} from './src/youtube/raw.js';
import { createRecommendationService } from './src/services/recommendations.js';
import { createShortsService } from './src/services/shorts.js';
import { createWatchHistoryRequestDeduper } from './src/services/watch-history.js';

const app = express();
const PORT = Number(process.env.PORT || 4646);
const EDU_CONFIG = 'https://raw.githubusercontent.com/siawaseok3/wakame/master/video_config.json';

if (process.env.NODE_ENV === 'production') Log.setLevel(Log.Level.ERROR);

const auth = createAuthService({
  app,
  Innertube,
  UniversalCache,
  authRoot: String(process.env.WETUBE_AUTH_ROOT || '/tmp/.wetube-auth').trim(),
  text,
  rawImage,
  proxied,
  youtubePromise,
  memory
});
const {
  ensureAuthClient, refreshAuthAccount, activeYouTube, accountClient,
  getAuthState, clearSessionCookie, authClients, authStates, authFlowPromises
} = auth;

const {
  makeShortSession, shortInfoToVideo, discoverSeedlessShorts,
  nextSeededShorts, getShortSession, prepareShorts
} = createShortsService({
  youtubePromise,
  eduParams: () => eduParams(EDU_CONFIG),
  walkRaw,
  text,
  proxied,
  bestThumbnail
});
const runWatchHistoryAddOnce = createWatchHistoryRequestDeduper();

const {
  enrichAuthorThumbnails, buildHomeRecommendations, getSignedInHomeVideos, getLocalRecommendations
} = createRecommendationService({
  youtubePromise,
  cached,
  userCached,
  collectVideos,
  collectShorts,
  normalizeVideo,
  YTNodes,
  discoverSeedlessShorts,
  accountClient,
  text,
  bestThumbnail,
  proxied,
  rawImage,
  PORT
});


app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', new URL('./views', import.meta.url).pathname);
app.use(compression());
app.use(express.json({ limit: '64kb' }));
const appScripts = [
  'theme', 'header', 'card-actions', 'watch', 'recommendations', 'shorts',
  'library', 'sidebar', 'auth', 'progress', 'queue', 'keyboard', 'channel',
  'library-controls', 'feed-pagination', 'settings', 'settings'
];
const staticAssets = [
  ['/style.css', 'style.css', 'text/css'],
  ['/watch.css', 'watch.css', 'text/css'],
  ['/app.js', 'app.js', 'application/javascript'],
  ...appScripts.map(name => [`/scripts/app-${name}.js`, `scripts/app-${name}.js`, 'application/javascript'])
];
for (const [route, file, type] of staticAssets) {
  app.get(route, (_req, res) => res.type(type).set('Cache-Control', 'public,max-age=86400').sendFile(new URL(`./public/${file}`, import.meta.url).pathname));
}
app.use('/styles', express.static(new URL('./public/styles', import.meta.url).pathname, { maxAge: '1d' }));

function render(res, data) { res.render('app', { page: data.page, title: data.title || 'WeTube', videos: data.videos || [], shorts: data.shorts || [], video: data.video || null, query: data.query || '', eduUrl: data.eduUrl || '', eduSources: data.eduSources || [], youtubeUrl: data.youtubeUrl || '', nocookieUrl: data.nocookieUrl || '', playerMode: data.playerMode || 'edu', isLive: Boolean(data.isLive), liveChatMode: data.liveChatMode || 'none', liveChatReplayAvailable: Boolean(data.liveChatReplayAvailable), liveChatAvailable: Boolean(data.liveChatAvailable), error: data.error || '', entity: data.entity || null, libraryType: data.libraryType || '', searchType: data.searchType || 'all', authenticated: Boolean(data.authenticated ?? false), channels: data.channels || [], channelContent: data.channelContent || { featured:null, uploads:[], shorts:[], playlists:[] }, shortSession: data.shortSession || '', shortChannelId: data.shortChannelId || '', feedToken: data.feedToken || '' }); }

const feedSessions = new Map();
const feedSessionTtl = 30 * 60 * 1000;
function makeFeedSession(feed, { seen = [], pending = [], fallbackFeed = null } = {}) {
  const now = Date.now();
  for (const [token, session] of feedSessions) if (session.expires <= now) feedSessions.delete(token);
  while (feedSessions.size >= 300) feedSessions.delete(feedSessions.keys().next().value);
  const token = randomUUID();
  feedSessions.set(token, {
    feed,
    fallbackFeed,
    seen: new Set(seen),
    pending: [...pending],
    expires: now + feedSessionTtl
  });
  return token;
}
function getFeedSession(token) {
  const session = feedSessions.get(String(token || ''));
  if (!session || session.expires <= Date.now()) {
    if (token) feedSessions.delete(String(token));
    return null;
  }
  session.expires = Date.now() + feedSessionTtl;
  return session;
}

const liveChatSessions = new Map();
const liveChatSessionTtl = 30 * 60 * 1000;
function sendLiveChatEvent(session, event) {
  const data = JSON.stringify(event);
  for (const client of session.clients) {
    if (!client.destroyed) {
      client.write(`data: ${data}\n\n`);
      client.flush?.();
    }
  }
}
function normalizeLiveChatMessage(action) {
  if (action?.type !== 'AddChatItemAction' || !action.item) return null;
  const item = action.item;
  const author = item.author || {};
  const messageText = item.message?.text || item.header_primary_text?.text ||
    item.header_subtext?.text || (item.type === 'LiveChatPaidSticker' ? 'ステッカー' : '');
  if (!messageText && !item.purchase_amount) return null;
  return {
    kind: 'message',
    id: String(item.id || randomUUID()),
    type: String(item.type || 'LiveChatTextMessage'),
    author: String(author.name || 'YouTube ユーザー'),
    avatar: proxied(author.avatar_thumbnail_url || author.best_thumbnail?.url || ''),
    text: String(messageText || ''),
    amount: String(item.purchase_amount || ''),
    timestamp: Number(item.timestamp || Date.now()),
    moderator: Boolean(author.is_moderator),
    owner: Boolean(author.is_creator),
    verified: Boolean(author.is_verified),
    sticker: proxied(item.sticker?.at?.(-1)?.url || item.sticker?.[0]?.url || '')
  };
}
function addLiveChatHistory(session, event) {
  if (event.kind === 'message') {
    session.history.push(event);
    if (session.history.length > 100) session.history.shift();
  }
  sendLiveChatEvent(session, event);
}
function removeLiveChatSession(token) {
  const session = liveChatSessions.get(token);
  if (!session) return;
  liveChatSessions.delete(token);
  clearTimeout(session.closeTimer);
  clearInterval(session.heartbeat);
  try { session.chat.stop(); } catch (error) {
    console.warn('Stop live chat:', error?.message || error);
  }
  for (const client of session.clients) client.end();
  session.clients.clear();
}
function pruneLiveChatSessions() {
  const now = Date.now();
  for (const [token, session] of liveChatSessions) {
    if (session.expires <= now && !session.clients.size) removeLiveChatSession(token);
  }
  while (liveChatSessions.size >= 100) {
    const idleToken = Array.from(liveChatSessions).find(([, session]) => !session.clients.size)?.[0];
    if (!idleToken) break;
    removeLiveChatSession(idleToken);
  }
}

app.post('/api/live-chat/start', async (req, res) => {
  const videoId = String(req.query.v || '');
  if (!/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: '動画IDが不正です。' });
  try {
    pruneLiveChatSessions();
    if (liveChatSessions.size >= 100) return res.status(503).json({ error: 'ライブチャットの同時接続数が上限に達しています。' });
    const info = await cached(`info:${videoId}`, 900000, () => youtubePromise.then(yt => yt.getInfo(videoId)));
    if (!info.livechat) return res.status(404).json({ error: 'この動画ではライブチャットを利用できません。' });
    const chat = info.getLiveChat();
    const token = randomUUID();
    const session = {
      videoId, chat, clients: new Set(), history: [], expires: Date.now() + liveChatSessionTtl,
      closeTimer: null, heartbeat: null, status: 'connecting'
    };
    liveChatSessions.set(token, session);
    session.closeTimer = setTimeout(() => removeLiveChatSession(token), 30000);
    chat.on('start', initial => {
      session.status = 'connected';
      sendLiveChatEvent(session, { kind: 'status', status: 'connected', viewer: String(initial.viewer_name || '') });
      for (const action of initial.actions || []) {
        const message = normalizeLiveChatMessage(action);
        if (message) addLiveChatHistory(session, message);
      }
    });
    chat.on('chat-update', action => {
      const message = normalizeLiveChatMessage(action);
      if (message) addLiveChatHistory(session, message);
      else if (action?.type === 'MarkChatItemAsDeletedAction') {
        sendLiveChatEvent(session, { kind: 'delete', id: String(action.target_item_id || '') });
      }
    });
    chat.on('error', error => {
      console.warn(`Live chat error [${videoId}]:`, error?.message || error);
      session.status = 'error';
      sendLiveChatEvent(session, { kind: 'status', status: 'error', message: 'ライブチャットの取得に失敗しました。' });
    });
    chat.on('end', () => {
      session.status = 'ended';
      sendLiveChatEvent(session, { kind: 'status', status: 'ended', message: 'ライブ配信が終了しました。' });
    });
    chat.start();
    res.set('Cache-Control', 'no-store').json({ token });
  } catch (error) {
    console.warn(`Start live chat [${videoId}]:`, error?.message || error);
    res.status(502).json({ error: 'ライブチャットを開始できませんでした。' });
  }
});

app.get('/api/live-chat/:token/events', (req, res) => {
  const token = String(req.params.token || '');
  const session = liveChatSessions.get(token);
  if (!session || session.expires <= Date.now()) {
    if (session) removeLiveChatSession(token);
    return res.status(404).end();
  }
  clearTimeout(session.closeTimer);
  session.expires = Date.now() + liveChatSessionTtl;
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  const client = res;
  session.clients.add(client);
  client.write(`data: ${JSON.stringify({ kind: 'status', status: session.status })}\n\n`);
  for (const event of session.history) client.write(`data: ${JSON.stringify(event)}\n\n`);
  client.flush?.();
  const heartbeat = setInterval(() => {
    if (!client.destroyed) {
      session.expires = Date.now() + liveChatSessionTtl;
      client.write(': keepalive\n\n');
      client.flush?.();
    }
  }, 15000);
  client.on('close', () => {
    clearInterval(heartbeat);
    session.clients.delete(client);
    if (!session.clients.size) {
      session.closeTimer = setTimeout(() => removeLiveChatSession(token), 30000);
    }
  });
});

app.post('/api/live-chat/:token/filter', (req, res) => {
  const session = liveChatSessions.get(String(req.params.token || ''));
  const filter = String(req.body?.filter || '');
  if (!session) return res.status(404).json({ error: 'ライブチャットの接続が終了しました。' });
  if (!['TOP_CHAT', 'LIVE_CHAT'].includes(filter)) return res.status(400).json({ error: 'チャットフィルターが不正です。' });
  try {
    session.chat.applyFilter(filter);
    session.expires = Date.now() + liveChatSessionTtl;
    res.set('Cache-Control', 'no-store').json({ ok: true });
  } catch (error) {
    console.warn(`Change live chat filter [${session.videoId}]:`, error?.message || error);
    res.status(409).json({ error: 'チャット表示を切り替えられませんでした。' });
  }
});
async function nextFeedPage(session, limit = 24) {
  const videos = [];
  const add = item => {
    if (!item?.id || session.seen.has(item.id)) return;
    session.seen.add(item.id);
    videos.push(item);
  };
  while (session.pending.length && videos.length < limit) add(session.pending.shift());
  let current = session.feed;
  for (let attempt = 0; videos.length < limit && attempt < 5; attempt++) {
    if (!current?.has_continuation) {
      if (!session.fallbackFeed) break;
      current = session.fallbackFeed;
      const next = await current.getContinuation();
      session.fallbackFeed = null;
      current = next;
    } else {
      current = await current.getContinuation();
    }
    const candidates = collectVideos(current, 200);
    for (let index = 0; index < candidates.length; index++) {
      if (videos.length >= limit) {
        session.pending.push(...candidates.slice(index));
        break;
      }
      add(candidates[index]);
    }
  }
  session.feed = current;
  return { videos, hasMore: Boolean(session.pending.length || current?.has_continuation || session.fallbackFeed) };
}

const accountHistorySessions = new Map();
const accountHistorySessionTtl = 30 * 60 * 1000;
function makeAccountHistorySession(sessionId, feed, { seen = [], pending = [] } = {}) {
  const now = Date.now();
  for (const [token, session] of accountHistorySessions) {
    if (session.expires <= now) accountHistorySessions.delete(token);
  }
  while (accountHistorySessions.size >= 300) accountHistorySessions.delete(accountHistorySessions.keys().next().value);
  const token = randomUUID();
  accountHistorySessions.set(token, {
    sessionId,
    feed,
    seen: new Set(seen),
    pending: [...pending],
    expires: now + accountHistorySessionTtl
  });
  return token;
}
function getAccountHistorySession(token, sessionId) {
  const session = accountHistorySessions.get(String(token || ''));
  if (!session || session.sessionId !== sessionId || session.expires <= Date.now()) {
    if (token) accountHistorySessions.delete(String(token));
    return null;
  }
  session.expires = Date.now() + accountHistorySessionTtl;
  return session;
}
async function getAccountHistoryVideoInfo(yt, videoId) {
  try {
    return await yt.getInfo(videoId);
  } catch (error) {
    console.warn('YouTube getInfo failed for watch-history tracking; using getBasicInfo:', error?.message || error);
    try {
      return await yt.getBasicInfo(videoId);
    } catch (fallbackError) {
      throw new AggregateError([error, fallbackError], 'Unable to retrieve video tracking info for watch history');
    }
  }
}
async function addVideoToAccountHistory(yt, videoId) {
  const info = await getAccountHistoryVideoInfo(yt, videoId);
  try {
    return await info.addToWatchHistory();
  } catch (error) {
    if (!/Playback tracking not available/i.test(String(error?.message || ''))) throw error;
    return (await yt.getBasicInfo(videoId)).addToWatchHistory();
  }
}
app.get('/api/auth/recommendation-diagnostics', async (req, res) => {
  try {
    const client = await accountClient(req);
    const state = getAuthState(req.wetubeSessionId);
    const result = { loggedIn: Boolean(client.session.logged_in), clientName: client.session.client_name || '', status: state.status, directVideos: 0, memoVideos: 0, normalizedVideos: 0, nodeTypes: {}, error: '' };
    const feed = await client.getHomeFeed();
    result.directVideos = Array.from(feed?.videos || []).length;
    const memos = [feed?.memo, feed?.page?.contents_memo, feed?.page?.header_memo, feed?.page?.on_response_received_actions_memo, feed?.page?.on_response_received_endpoints_memo].filter(Boolean);
    for (const memo of memos) if (memo instanceof Map) for (const [type, nodes] of memo.entries()) result.nodeTypes[type] = (result.nodeTypes[type] || 0) + (Array.isArray(nodes) ? nodes.length : 1);
    result.memoVideos = collectVideos(memos, 100).length;
    result.normalizedVideos = normalizeFeedVideos(feed, 100).length;
    res.set('Cache-Control', 'no-store').json(result);
  } catch (error) {
    const status = error?.status || 401;
    res.status(status).set('Cache-Control', 'no-store').json({ loggedIn:false, status:'signed_out', directVideos:0, memoVideos:0, normalizedVideos:0, nodeTypes:{}, error:String(error?.message || error) });
  }
});

app.get('/api/auth/status', async (req, res) => {
  try {
    const client = await ensureAuthClient(req);
    const state = getAuthState(req.wetubeSessionId);
    if (client.session.logged_in) {
      state.status = 'signed_in';
      if (!state.account?.avatar) await refreshAuthAccount(client, req.wetubeSessionId);
    }
    else if (state.status === 'signed_in') { state.status = 'signed_out'; state.account = null; }
    res.set('Cache-Control', 'no-store').json({ ...state, recommendationSource: client.session.logged_in ? 'account' : 'local' });
  } catch (error) {
    const state = getAuthState(req.wetubeSessionId);
    res.set('Cache-Control', 'no-store').json({ ...state, status:'signed_out', account:null, recommendationSource:'local', error:state.error || String(error?.message || error) });
  }
});
app.post('/api/auth/start', async (req, res) => {
  const sid = req.wetubeSessionId;
  try {
    const client = await ensureAuthClient(req);
    const state = getAuthState(sid);
    if (client.session.logged_in) return res.json({ status: 'signed_in', account: state.account || await refreshAuthAccount(client, sid) });
    if (!authFlowPromises.has(sid)) {
      authStates.set(sid, { status:'starting', userCode:'', verificationUrl:'', expiresAt:0, account:null, error:'' });
      const flow = client.session.signIn().then(async () => {
        authStates.set(sid, { ...getAuthState(sid), status:'signed_in', error:'' });
        await refreshAuthAccount(client, sid);
      }).catch(error => {
        console.error(`OAuth sign-in [${sid.slice(0,8)}]:`, error);
        authStates.set(sid, { status:'error', userCode:'', verificationUrl:'', expiresAt:0, account:null, error:'認証を開始できませんでした。時間をおいて再試行してください。' });
      }).finally(() => authFlowPromises.delete(sid));
      authFlowPromises.set(sid, flow);
    }
    res.status(202).json({ status: getAuthState(sid).status });
  } catch (error) {
    console.error('OAuth start:', error);
    res.status(500).json({ status:'error', error:'認証クライアントを初期化できませんでした。' });
  }
});
app.post('/api/auth/signout', async (req, res) => {
  const sid = req.wetubeSessionId;
  try {
    const client = await ensureAuthClient(req);
    if (client.session.logged_in) await client.session.signOut();
    await client.session.oauth.removeCache();
    authClients.delete(sid);
    authStates.delete(sid);
    authFlowPromises.delete(sid);
    for (const key of [
      'account:recommendations:v5',
      'account:liked:v4',
      'account:history:v3',
      'account:watch-later:v1',
      'account:subscriptions:v3'
    ]) memory.delete(`user:${sid}:${key}`);
    clearSessionCookie(res);
    res.json({ status:'signed_out' });
  } catch (error) {
    console.error('OAuth sign-out:', error);
    res.status(500).json({ status:'error', error:'ログアウトできませんでした。' });
  }
});

app.get('/image-proxy', async (req, res) => {
  try {
    const url = new URL(String(req.query.url || '')); if (url.protocol !== 'https:' || !isImageHost(url.hostname)) return res.sendStatus(403);
    const upstream = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'image/avif,image/webp,image/*' }, redirect: 'follow' });
    const final = new URL(upstream.url), type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !isImageHost(final.hostname) || !type.startsWith('image/')) return res.sendStatus(502);
    const data = Buffer.from(await upstream.arrayBuffer()); if (data.length > 8 * 1024 * 1024) return res.sendStatus(413);
    res.type(type).set({ 'Cache-Control': 'public,max-age=86400,stale-while-revalidate=604800', 'X-Content-Type-Options': 'nosniff' }).send(data);
  } catch { res.sendStatus(502); }
});
app.get('/', (req, res, next) => {
  // Render the shell immediately. Recommendations are fetched client-side so
  // the first paint is not blocked by YouTube/Innertube network calls.
  try {
    render(res, { page: 'home', title: 'ホーム', videos: [], shorts: [], authenticated: false });
  } catch (e) { next(e); }
});
app.get('/settings', (_req, res) => {
  render(res, { page:'settings', title:'設定' });
});
app.get('/search', async (req, res, next) => {
  const query = String(req.query.q || '').trim().slice(0, 100); if (!query) return res.redirect('/');
  const requested = String(req.query.type || 'all');
  const searchType = ['all','video','channel','playlist'].includes(requested) ? requested : 'all';
  try {
    const options = searchType === 'all' ? {} : { type: searchType };
    const result = await cached(`search:${searchType}:${query}`, 300000, () => youtubePromise.then(yt => yt.search(query, options)));
    const candidates = searchType === 'channel' ? [] : collectVideos(result, 200);
    const videos = candidates.slice(0, 50);
    const feedToken = searchType !== 'channel' && (result?.has_continuation || candidates.length > videos.length)
      ? makeFeedSession(result, { seen: videos.map(video => video.id), pending: candidates.slice(videos.length) })
      : '';
    render(res, { page: 'search', title: `${query} - 検索`, query, searchType, videos, feedToken, channels: searchType === 'video' || searchType === 'playlist' ? [] : collectChannels(result, 30) });
  } catch (e) { next(e); }
});

app.post('/api/feed/next', async (req, res) => {
  const session = getFeedSession(req.body?.token);
  if (!session) return res.status(410).set('Cache-Control', 'no-store').json({ error:'フィードの有効期限が切れました。ページを再読み込みしてください。' });
  try {
    const result = await nextFeedPage(session);
    return res.set('Cache-Control', 'no-store').json(result);
  } catch (error) {
    console.error('Feed continuation:', error?.message || error);
    return res.status(502).set('Cache-Control', 'no-store').json({ error:'動画を追加で読み込めませんでした。' });
  }
});

app.get(['/shorts', '/shorts/:id'], async (req, res, next) => {
  try {
    const yt = await youtubePromise;
    const targetId = String(req.params.id || '').trim();
    const channelId = String(req.query.channel || '').trim();
    const params = await eduParams(EDU_CONFIG);
    let feed = null, channelTitle = '', initial = [], mode = 'feed', seedId = '', seedIds = [];

    if (/^[\w-]{11}$/.test(targetId)) {
      try {
        const info = await yt.getBasicInfo(targetId);
        const video = shortInfoToVideo(info);
        if (video?.id) {
          video.isShort = true;
          initial.push(video);
          seedId = targetId;
        }
      } catch {}
    }

    if (/^UC[\w-]{20,}$/.test(channelId)) {
      const channel = await yt.getChannel(channelId);
      channelTitle = text(channel.title, 'チャンネル');
      if (channel.has_shorts) {
        feed = await channel.getShorts();
        initial.push(...collectShorts(feed, 48));
      }
    } else {
      // Prefer YouTube's seedless Shorts sequence. Search is only a fallback
      // because WEB search commonly exposes ordinary Video nodes instead of Shorts.
      try {
        const seeded = await discoverSeedlessShorts(yt, 24);
        initial.push(...seeded.videos);
        if (!seedId) seedId = seeded.seedId;
        seedIds = seeded.seedIds || [];
        mode = 'seedless';
      } catch {}
      if (initial.length < 12) {
        const searches = await Promise.all(['shorts','viral shorts','short video'].map(term => yt.search(term, { type: 'video' }).catch(() => null)));
        for (const result of searches) {
          if (!result) continue;
          initial.push(...collectShorts(result, 80));
          initial.push(...collectVideos(result, 100).filter(video => video.isShort));
          if (initial.length >= 48) break;
        }
        feed = searches.find(Boolean) || null;
      }
    }
    const deduped = [], seen = new Set();
    for (const item of initial) if (item?.id && !seen.has(item.id)) { seen.add(item.id); deduped.push(item); }
    const token = makeShortSession(feed, { channelId, channelTitle, seen: [...seen], mode, seedId, seedIds });
    const videos = prepareShorts(deduped.slice(0, 48), params, { channelId, channelTitle });
    const authClient = await ensureAuthClient(req);
    render(res, { page: 'shorts', title: channelTitle ? `${channelTitle} - ショート` : 'ショート', videos, shortSession: token, shortChannelId: channelId, authenticated: Boolean(authClient.session.logged_in) });
  } catch (error) { next(error); }
});
app.get('/api/shorts/next', async (req, res) => {
  try {
    const session = getShortSession(req.query.token);
    if (!session) return res.json({ videos: [], hasMore: false });
    const params = await eduParams(EDU_CONFIG);
    if (session.mode === 'seedless' && session.seedIds.length) {
      const batch = await nextSeededShorts(await youtubePromise, session, 24);
      const videos = prepareShorts(batch.videos, params, session);
      return res.set('Cache-Control', 'no-store').json({ videos, hasMore: batch.hasMore });
    }
    if (session.mode === 'seedless' && session.seedId) {
      const info = await youtubePromise.then(yt => yt.getShortsVideoInfo(session.seedId));
      const ids = [...new Set(Array.from(info.watch_next_feed || []).map(endpoint => endpoint?.payload?.videoId).filter(id => /^[\w-]{11}$/.test(String(id || ''))))].filter(id => !session.seen.has(id));
      const infos = await Promise.all(ids.slice(0, 24).map(id => youtubePromise.then(yt => yt.getBasicInfo(id).catch(() => null))));
      const batch = infos.map(shortInfoToVideo).filter(video => video.id && !session.seen.has(video.id));
      for (const item of batch) session.seen.add(item.id);
      if (batch.length) session.seedId = batch.at(-1).id;
      const videos = prepareShorts(batch.slice(0, 24), params, session);
      return res.set('Cache-Control', 'no-store').json({ videos, hasMore: Boolean(session.seedId) && batch.length > 0 });
    }
    if (!session.feed?.has_continuation || typeof session.feed.getContinuation !== 'function') return res.json({ videos: [], hasMore: false });
    let current = session.feed, batch = [];
    for (let attempt = 0; attempt < 3 && !batch.length; attempt++) {
      current = await current.getContinuation();
      batch = collectShorts(current, 80).filter(video => !session.seen.has(video.id));
    }
    session.feed = current;
    for (const item of batch) session.seen.add(item.id);
    const videos = prepareShorts(batch.slice(0, 48), params, session);
    res.set('Cache-Control', 'no-store').json({ videos, hasMore: Boolean(current?.has_continuation) });
  } catch (error) {
    console.error('Shorts continuation:', error?.message || error);
    res.status(502).json({ videos: [], hasMore: false });
  }
});

app.get('/feed/:type', async (req, res, next) => {
  const labels = { trending: '急上昇', music: '音楽', gaming: 'ゲーム', news: 'ニュース' };
  const type = String(req.params.type || '');
  if (!labels[type]) return res.redirect('/');
  try {
    const yt = await youtubePromise;
    let result;
    if (type === 'trending' && typeof yt.getTrending === 'function') {
      try { result = await cached('feed:trending', 300000, () => yt.getTrending()); } catch {}
    }
    if (!result) result = await cached(`feed:${type}`, 300000, () => yt.search(labels[type], { type: 'video' }));
    render(res, { page: 'search', title: labels[type], query: labels[type], videos: collectVideos(result, 50) });
  } catch (e) { next(e); }
});
app.get('/my-channel', async (req, res) => {
  try {
    const client = await accountClient(req);
    const info = await client.account.getInfo();
    const id = info.external_channel_id || info.channel_id || info.channelId || info.id || '';
    return id ? res.redirect(`/channel/${encodeURIComponent(id)}`) : res.redirect('/');
  } catch { return res.redirect('/'); }
});
app.get('/playlists', async (req, res, next) => {
  try {
    const authClient = await ensureAuthClient(req);
    let playlists = [];
    if (authClient.session.logged_in) {
      try {
        const library = await authClient.getLibrary();
        playlists = library ? collectPlaylists(library, 80) : [];
      } catch (err) {
        console.warn('Account playlists error:', err?.message || err);
      }
    }
    if (!playlists.length) {
      try {
        const yt = await youtubePromise;
        const search = await cached('playlists:popular', 300000, () => yt.search('人気 再生リスト', { type: 'playlist' }));
        playlists = collectPlaylists(search, 40);
      } catch {}
    }
    render(res, { page: 'search', title: '再生リスト', query: '再生リスト', videos: playlists, authenticated: Boolean(authClient.session.logged_in) });
  } catch (error) { next(error); }
});

for (const [route, title, type] of [['/subscriptions','登録チャンネル','subscriptions'],['/history','履歴','history'],['/watch-later','後で見る','watchLater'],['/liked','高く評価した動画','likedVideos']]) {
  app.get(route, (_req, res) => render(res, { page: 'library', title, libraryType: type }));
}

app.post('/api/recommendations', async (req, res) => {
  try {
    const body = req.body || {};
    const excluded = [...new Set((Array.isArray(body.exclude) ? body.exclude : [])
      .map(String).filter(id => /^[\w-]{11}$/.test(id)))].slice(0, 500);
    const client = await ensureAuthClient(req);
    if (client.session.logged_in) {
      try {
        const home = excluded.length
          ? await getSignedInHomeVideos(req, 50, excluded)
          : await userCached(req, 'account:recommendations:v5', 60000, () => getSignedInHomeVideos(req, 50));
        if (!home.videos.length && !home.shorts.length) {
          throw new Error('YouTube account home feed returned no videos');
        }
        const videos = home.videos.map(video => ({ ...video, reasons: ['YouTubeアカウント'] }));
        const shorts = home.shorts.map(video => ({ ...video, reasons: ['Shorts'] }));
        return res.json({ videos, shorts, hasMore:home.hasMore, source:'account', authenticated:true, error:videos.length || shorts.length ? '' : 'YouTubeアカウントのホームフィードが空でした。' });
      } catch (error) {
        console.error(`Authenticated recommendations [${req.wetubeSessionId.slice(0,8)}]:`, error?.message || error);
        return res.status(502).json({ videos:[], shorts:[], source:'account', authenticated:true, error:'Googleアカウントのおすすめを取得できませんでした。しばらくしてから再試行してください。' });
      }
    }
    const recommendations = await getLocalRecommendations(body, excluded);
    return res.json(recommendations);
  } catch(error) { console.error('recommendations:',error); return res.status(502).json({videos:[],shorts:[],source:'local',authenticated:false,error:'おすすめを取得できませんでした。'}); }
});

app.get('/api/videos', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(x => x.trim()).filter(x => /^[\w-]{11}$/.test(x)).slice(0, 50);
  if (!ids.length) return res.json({ videos: [] });
  try {
    const yt = await youtubePromise;
    const rows = await Promise.all(ids.map(async id => {
      try {
        const info = await cached(`basic:v2:${id}`, 900000, () => yt.getBasicInfo(id));
        const b = info.basic_info || {}, owner = info.secondary_info?.owner?.author || {}, channel = b.channel || {};
        const author = text(b.author || channel.name || owner.name, 'YouTube');
        const authorId = b.channel_id || channel.id || owner.id || '';
        const authorThumbnail = proxied(bestThumbnail(channel.thumbnail)?.url || bestThumbnail(channel.thumbnails)?.url || owner.best_thumbnail?.url || bestThumbnail(owner.thumbnails)?.url || rawImage(owner));
        const durationSeconds = Number(b.duration?.seconds ?? b.duration_seconds ?? b.durationSeconds ?? b.duration);
        const totalSeconds = Math.floor(durationSeconds);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
          ? hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
          : text(b.duration?.text || b.duration?.simple_text || b.duration?.simpleText, '');
        return { id, title: b.title || `動画 (${id})`, author, authorId, authorThumbnail, thumbnail: proxied(b.thumbnail?.at?.(-1)?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`), duration, views: formatViewCount(b.view_count), published: b.publish_date || '' };
      } catch {
        return { id, title:`動画 (${id})`, author:'チャンネル不明', authorId:'', authorThumbnail:'', thumbnail:proxied(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`), duration:'', views:'', published:'' };
      }
    }));
    res.json({ videos: rows.filter(Boolean) });
  } catch { res.json({ videos: [] }); }
});

app.get('/api/edu-params', async (_req, res) => {
  try {
    const sources = await eduParamSources();
    res.set('Cache-Control', 'public,max-age=300').json({ sources });
  } catch {
    res.status(502).json({ sources: [] });
  }
});

app.get('/watch', async (req, res, next) => {
  const id = String(req.query.v || ''); if (!/^[\w-]{11}$/.test(id)) return res.redirect('/');
  try {
    const yt = await youtubePromise; const [info, params, eduSources] = await Promise.all([cached(`info:${id}`, 900000, () => yt.getInfo(id)), eduParams(EDU_CONFIG), eduParamSources()]); const b = info.basic_info || {};
    const authorId = b.channel_id || b.channel?.id || info.secondary_info?.owner?.author?.id || '';
    let authorThumbnail = proxied(
      bestThumbnail(b.channel?.thumbnail)?.url ||
      bestThumbnail(b.channel?.thumbnails)?.url ||
      info.secondary_info?.owner?.author?.best_thumbnail?.url ||
      bestThumbnail(info.secondary_info?.owner?.author?.thumbnails)?.url ||
      rawImage(info.secondary_info?.owner?.author || info.secondary_info?.owner)
    );
    const owner = info.secondary_info?.owner || {};
    let subscribers = text(owner.subscriber_count || owner.subscribers, '');
    let canonicalChannel = null;
    if (authorId) {
      try {
        canonicalChannel = await cached(`channel:profile:v1:${authorId}`, 3600000, () => yt.getChannel(authorId));
        authorThumbnail = proxied(
          bestThumbnail(canonicalChannel.metadata?.avatar)?.url ||
          bestThumbnail(canonicalChannel.metadata?.thumbnail)?.url ||
          rawImage(canonicalChannel.header || canonicalChannel.metadata)
        ) || authorThumbnail;
        const headerRows = canonicalChannel.header?.content?.metadata?.metadata_rows ||
          canonicalChannel.header?.content?.metadata?.metadataRows || [];
        const headerParts = headerRows.flatMap(row => row.metadata_parts || row.metadataParts || [])
          .map(part => text(part.text || part)).filter(Boolean);
        subscribers = headerParts.find(value => /登録者|subscribers/i.test(value)) || subscribers;
      } catch (error) {
        console.warn(`Resolve watch channel metadata [${authorId}]:`, error?.message || error);
      }
    }
    if (/^N\/A$/i.test(subscribers)) subscribers = '';
    let likeCount = '', shortLikeCount = '';
    walkRaw(info.primary_info, node => {
      if (node?.short_like_count && !shortLikeCount) shortLikeCount = String(node.short_like_count);
      if (node?.like_count && !likeCount) likeCount = typeof node.like_count === 'number' ? Number(node.like_count).toLocaleString('ja-JP') : String(node.like_count);
    });
    if (!shortLikeCount && likeCount) shortLikeCount = likeCount;

    const isLive = Boolean(b.is_live && !b.is_upcoming && !b.is_post_live_dvr && !info.livechat?.is_replay);
    const liveChatReplayAvailable = Boolean(info.livechat && !isLive && !b.is_upcoming);
    const liveChatMode = isLive ? 'live' : liveChatReplayAvailable ? 'replay' : 'none';
    const video = {
      id,
      title: b.title || '動画',
      author: b.channel?.name || b.author || canonicalChannel?.metadata?.title || 'YouTube',
      authorId,
      authorThumbnail,
      views: formatViewCount(b.view_count),
      published: text(info.primary_info?.relative_date, text(info.primary_info?.published, b.publish_date || '')),
      description: b.short_description || '',
      subscribers,
      likeCount: shortLikeCount || likeCount || '高評価'
    };
    let related = Array.from(info.watch_next_feed || []).map(normalizeVideo).filter(Boolean).filter(x => x.id !== id);
    let relatedFeed = null;
    const relatedQuery = [b.title, b.author].filter(Boolean).join(' ').trim();
    if (relatedQuery) {
      try {
        relatedFeed = await yt.search(relatedQuery, { type: 'video' });
        const more = collectVideos(relatedFeed, 200);
        const ids = new Set(related.map(x => x.id));
        for (const item of more) if (item.id !== id && !ids.has(item.id)) { ids.add(item.id); related.push(item); }
      } catch (error) {
        console.warn(`Load related video candidates [${id}]:`, error?.message || error);
      }
    }
    const relatedVideos = related.slice(0, 24);
    const relatedPending = related.slice(relatedVideos.length);
    let watchNextFeed = null;
    if (typeof info.getWatchNextContinuation === 'function') {
      let hasContinuation = true;
      const createWatchNextPage = contents => ({
        videos: contents,
        get has_continuation() { return hasContinuation; },
        getContinuation: async () => {
          try {
            await info.getWatchNextContinuation();
            return createWatchNextPage(info.watch_next_feed || []);
          } catch (error) {
            hasContinuation = false;
            console.warn(`Watch-next related continuation unavailable [${id}]:`, error?.message || error);
            return createWatchNextPage([]);
          }
        }
      });
      watchNextFeed = createWatchNextPage(info.watch_next_feed || []);
    }
    const relatedFeedToken = relatedFeed?.has_continuation || relatedPending.length || watchNextFeed
      ? makeFeedSession(relatedFeed, {
        seen: relatedVideos.map(item => item.id),
        pending: relatedPending,
        fallbackFeed: watchNextFeed
      })
      : '';
    const authClient = await ensureAuthClient(req);
    render(res, {
      page: 'watch',
      title: video.title,
      video,
      isLive,
      liveChatMode,
      liveChatReplayAvailable,
      liveChatAvailable: Boolean(info.livechat),
      videos: relatedVideos,
      feedToken: relatedFeedToken,
      authenticated: Boolean(authClient.session.logged_in),
      playerMode: ['youtube', 'nocookie'].includes(req.query.player) ? req.query.player : 'edu',
      eduUrl: `https://www.youtubeeducation.com/embed/${id}${params}&enablejsapi=1`,
      eduSources: eduSources.map(source => ({ name: source.name, url: `https://www.youtubeeducation.com/embed/${id}${source.params}&enablejsapi=1` })),
      youtubeUrl: `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0&enablejsapi=1`,
      nocookieUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&enablejsapi=1`
    });
  } catch (e) { next(e); }
});

app.get('/api/notifications', async (req, res) => {
  try {
    const authClient = await ensureAuthClient(req);
    if (!authClient.session.logged_in) {
      return res.set('Cache-Control', 'no-store').json({ notifications: [], authenticated: false, status: 'signed_out' });
    }
    const menu = await authClient.getNotifications();
    const notifications = (menu.contents || []).slice(0, 30).map(item => {
      const endpoint = item.endpoint?.payload || {};
      const videoId = String(endpoint.videoId || endpoint.video_id || '').match(/^[\w-]{11}$/)?.[0] || '';
      const channelId = String(endpoint.browseId || '').match(/^UC[\w-]{20,}$/)?.[0] || '';
      const playlistId = String(endpoint.playlistId || '').match(/^[\w-]+$/)?.[0] || '';
      let url = videoId ? `/watch?v=${encodeURIComponent(videoId)}`
        : channelId ? `/channel/${encodeURIComponent(channelId)}`
          : playlistId ? `/playlist?list=${encodeURIComponent(playlistId)}` : '';
      if (!url) {
        try {
          const target = new URL(item.endpoint?.toURL?.() || '', 'https://www.youtube.com');
          if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(target.hostname)) {
            const targetVideoId = target.searchParams.get('v') || target.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})$/)?.[1];
            const targetChannelId = target.pathname.match(/^\/channel\/(UC[\w-]{20,})$/)?.[1];
            const targetPlaylistId = target.searchParams.get('list');
            if (targetVideoId) url = target.pathname.startsWith('/shorts/')
              ? `/shorts/${encodeURIComponent(targetVideoId)}`
              : `/watch?v=${encodeURIComponent(targetVideoId)}`;
            else if (targetChannelId) url = `/channel/${encodeURIComponent(targetChannelId)}`;
            else if (targetPlaylistId) url = `/playlist?list=${encodeURIComponent(targetPlaylistId)}`;
          }
        } catch {}
      }
      if (!url) return null;
      const thumbnails = item.video_thumbnails?.length ? item.video_thumbnails : item.thumbnails || [];
      return {
        id: String(item.notification_id || videoId),
        title: text(item.short_message, ''),
        author: '',
        authorThumbnail: '',
        thumbnail: proxied(thumbnails.at(-1)?.url || ''),
        published: text(item.sent_time, ''),
        url
      };
    }).filter(item => item?.title).slice(0, 10);
    const hasInboxItems = Boolean(menu.contents?.length);
    const status = notifications.length ? 'ok' : hasInboxItems ? 'error' : 'empty';
    res.set('Cache-Control', 'no-store').json({
      notifications, authenticated: true, status,
      ...(status === 'error' ? { error: '通知は取得できましたが、対応するリンクがありません。' } : {})
    });
  } catch (err) {
    console.warn('Account notifications unavailable:', err?.message || err);
    res.status(502).set('Cache-Control', 'no-store').json({ notifications: [], authenticated: true, status: 'error', error: '通知を取得できませんでした。' });
  }
});

async function collectChannelFeed(feed, kind = 'videos', limit = 240, maxPages = 10) {
  const output = [], ids = new Set();
  let current = feed;
  for (let page = 0; current && page < maxPages && output.length < limit; page++) {
    const batch = kind === 'playlists' ? collectPlaylists(current, limit) : kind === 'shorts' ? Array.from(current?.videos || []).map(normalizeShort).filter(Boolean) : normalizeFeedVideos(current, limit);
    for (const item of batch) {
      if (!item || ids.has(item.id)) continue;
      ids.add(item.id);
      if (kind === 'shorts') item.isShort = true;
      output.push(item);
      if (output.length >= limit) break;
    }
    if (output.length >= limit || !current.has_continuation || typeof current.getContinuation !== 'function') break;
    try { current = await current.getContinuation(); }
    catch (error) { console.warn(`Channel ${kind} continuation:`, error?.message || error); break; }
  }
  return output;
}
function collectCommunityPosts(source, limit = 80) {
  const out = [], ids = new Set(), seen = new WeakSet();
  function walk(node, depth = 0) {
    if (!node || depth > 12 || out.length >= limit) return;
    if (Array.isArray(node)) return node.forEach(value => walk(value, depth + 1));
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const type = String(node.type || node.constructor?.type || node.constructor?.name || '');
    if (/BackstagePost|Post|SharedPost/.test(type)) {
      const id = node.id || node.post_id || node.postId;
      if (id && !ids.has(id)) {
        ids.add(id);
        const author = node.author || {};
        const postText = text(node.content || node.content_text || node.contentText, '');
        const published = text(node.published, '');
        const likes = text(node.vote_count || node.like_count, '');
        const replies = text(node.action_buttons?.reply_button?.text || node.reply_count, '');
        const attachment = node.attachment?.image || node.attachment?.thumbnail || node.image || [];
        const image = proxied(Array.isArray(attachment) ? attachment.at(-1)?.url : attachment?.url);
        out.push({ id:String(id), postId:String(id), isPost:true, title:'', content:postText, author:text(author.name,'YouTube'), authorId:author.id || '', authorThumbnail:proxied(rawImage(author)), thumbnail:image, published, views:likes, replies });
      }
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  }
  walk(source); return out;
}
async function resolveChannelId(input) {
  const value=String(input||'').trim();
  if (/^UC[\w-]{20,}$/.test(value)) return value;
  const yt=await youtubePromise;
  const endpoint=await yt.resolveURL(`https://www.youtube.com/${value.startsWith('@')?value:`@${value}`}`);
  return endpoint?.payload?.browseId || '';
}
for (const route of ['/@:handle','/c/:handle','/user/:handle']) {
  app.get(route, async (req,res,next) => {
    try {
      const id=await resolveChannelId(req.params.handle);
      if(!id) return res.redirect('/');
      const query=new URLSearchParams(req.query).toString();
      res.redirect(`/channel/${encodeURIComponent(id)}${query?`?${query}`:''}`);
    } catch(error) { next(error); }
  });
}
app.get('/channel/:id', async (req,res,next) => {
  const id=String(req.params.id||''), tab=String(req.query.tab||'home'), query=String(req.query.q||'').trim().slice(0,80), sort=String(req.query.sort||'latest');
  const validTabs=new Set(['home','videos','shorts','live','playlists','community','about']); if(!validTabs.has(tab))return res.redirect(`/channel/${encodeURIComponent(id)}`);
  try {
    const yt=await youtubePromise, root=await cached(`channel:root:${id}`,600000,()=>yt.getChannel(id)); let feed=root, about=null;
    if(query&&root.has_search) feed=await root.search(query);
    else if(tab==='videos'&&root.has_videos) {
      feed=await root.getVideos();
      if (sort==='popular' && typeof feed.applySort==='function') {
        const popularFilter=(feed.sort_filters||[]).find(label => /人気|popular|most viewed/i.test(String(label)));
        if (popularFilter) try { feed=await feed.applySort(popularFilter); } catch (error) { console.warn('Channel popular sort:', error?.message || error); }
      }
    }
    else if(tab==='shorts'&&root.has_shorts) feed=await root.getShorts();
    else if(tab==='live'&&root.has_live_streams) feed=await root.getLiveStreams();
    else if(tab==='playlists'&&root.has_playlists) feed=await root.getPlaylists();
    else if(tab==='community'&&root.has_community) feed=await root.getCommunity?.() || root;
    else if(tab==='home'&&root.has_home) feed=await root.getHome();
    else if(tab==='about'&&root.has_about) about=await root.getAbout();
    const m=root.metadata||{}, h=root.header||{}, hc=h.content||{};
    const headerMeta=hc.metadata||{};
    const headerRows=headerMeta.metadata_rows||headerMeta.metadataRows||[];
    const headerParts=headerRows.flatMap(row=>row.metadata_parts||row.metadataParts||[]).map(part=>text(part.text||part)).filter(Boolean);
    const thumb=list=>bestThumbnail(list)?.url||'';
    const headerImage=hc.image?.avatar?.image || hc.image?.avatar?.thumbnails || [];
    const title=text(m.title||h.page_title||hc.title?.text||hc.title,'チャンネル');
    const handle=headerParts.find(value=>value.startsWith('@'))||text(m.handle||m.channel_handle,'');
    const subscribers=headerParts.find(value=>/登録者|subscribers/i.test(value))||'';
    const videosCount=headerParts.find(value=>/本の動画|videos/i.test(value))||'';
    const description=text(m.description||about?.description||about?.description_text,'');
    const bannerImage=hc.hero_image?.image || hc.hero_image?.sources || h.banner || h.tv_banner || h.mobile_banner;
    const entity={type:'channel',id,title,handle,description,image:proxied(thumb(headerImage)||thumb(m.avatar||m.thumbnail)||rawImage(h)),banner:proxied(thumb(bannerImage)),subscribers,videosCount,tab,query,sort,verified:Boolean(hc.title?.text?.runs?.some(run=>run.attachment?.element?.type?.imageType?.image?.sources?.some(source=>source.clientResource?.imageName==='CHECK_CIRCLE_FILLED'))||h.author?.is_verified||m.is_verified),externalUrl:text(m.vanity_channel_url||m.url_canonical||m.url,''),tabs:{home:Boolean(root.has_home),videos:Boolean(root.has_videos),shorts:Boolean(root.has_shorts),live:Boolean(root.has_live_streams),playlists:Boolean(root.has_playlists),community:Boolean(root.has_community),about:Boolean(root.has_about)},about:about?{views:text(about.views||about.view_count,''),joined:text(about.joined_date||about.joined,''),country:text(about.country,''),links:about.links||[]}:null};
    let items = [];
    if (tab !== 'about') {
      const feedKind = tab === 'playlists' ? 'playlists' : tab === 'shorts' ? 'shorts' : 'videos';
      items = await collectChannelFeed(feed, feedKind, tab === 'shorts' ? 240 : tab === 'playlists' ? 120 : 60, tab === 'shorts' ? 20 : tab === 'playlists' ? 10 : 2);
      // Fall back to root only if the selected feed yielded nothing.
      if (!items.length) items = tab === 'playlists' ? collectPlaylists(root, 60) : collectVideos(root, 120);
      if (tab === 'shorts') items = items.map(item => ({ ...item, isShort: true }));
      // Last-resort channel-scoped discovery for video-like tabs.
      if (!items.length && tab !== 'playlists') {
        try {
          const suffix = { shorts: ' ショート', live: ' ライブ' }[tab] || '';
          const searched = collectVideos(await yt.search(`${title}${suffix}`, { type: 'video' }), 80);
          const normalizedTitle = title.toLocaleLowerCase('ja');
          items = searched.filter(item => item.authorId === id || item.author.toLocaleLowerCase('ja').includes(normalizedTitle)).slice(0, 40);
        } catch {}
      }
    }
    if (tab==='videos' && sort==='popular' && !(feed.sort_filters||[]).some(label => /人気|popular|most viewed/i.test(String(label)))) items=[...items].sort((a,b)=>numericViews(b.views)-numericViews(a.views));
    items=items.map(item=>item.isPlaylist||item.isPost?item:{...item,author:title,authorId:id,authorThumbnail:entity.image||item.authorThumbnail});
    const channelContent={
      featured: tab==='home' ? items.find(item=>!item.isShort&&!item.isPlaylist) || null : null,
      uploads: items.filter(item=>!item.isShort&&!item.isPlaylist).slice(tab==='home'?1:0, tab==='home'?13:80),
      shorts: items.filter(item=>item.isShort).slice(0,18),
      playlists: items.filter(item=>item.isPlaylist).slice(0,12)
    };
    render(res,{page:'channel',title,entity,videos:items,channelContent});
  } catch(error){next(error)}
});

app.get('/playlist', async (req, res, next) => { try { const x = await (await youtubePromise).getPlaylist(String(req.query.list || '')), m = x.metadata || x.header || {}; render(res, { page: 'collection', title: text(m.title, 'プレイリスト'), entity: { type: 'playlist', title: text(m.title, 'プレイリスト'), description: text(m.description, ''), author: text(m.author?.name || m.owner?.name, ''), image: proxied(rawImage(m)) }, videos: collectVideos(x, 100) }); } catch (e) { next(e); } });
function normalizeCommentView(comment, replyCount = 0) {
  const author = comment?.author;
  const body = text(comment?.content || comment?.content_text || comment?.comment_text, '').trim();
  const authorName = text(author?.name || comment?.author_button_a11y || author || comment?.author_text, '').trim();
  if (!body || !authorName) return null;
  return {
    id: String(comment.comment_id || comment.id || ''),
    body,
    author: authorName,
    avatar: proxied(author?.avatar_thumbnail_url || rawImage(author) || rawImage(comment?.author_thumbnail) || rawImage(comment?.authorThumbnail)),
    published: text(comment.published_time || comment.published, ''),
    likes: text(comment.like_count || comment.like_count_liked || comment.vote_count || comment.like_count, ''),
    replies: Number(replyCount || comment.reply_count || 0)
  };
}
function collectComments(source) {
  const threads = Array.from(source?.contents || []);
  if (threads.length) {
    return threads.map(thread => normalizeCommentView(thread.comment || thread, thread.comment?.reply_count))
      .filter(Boolean).slice(0, 40);
  }
  const out = [], seen = new WeakSet();
  function walk(node, depth = 0) {
    if (!node || depth > 10 || out.length >= 40) return;
    if (Array.isArray(node)) return node.forEach(value => walk(value, depth + 1));
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const normalized = normalizeCommentView(node);
    if (normalized) out.push(normalized);
    Object.values(node).forEach(value => walk(value, depth + 1));
  }
  walk(source);
  return out;
}
async function accountChannelId(client, channelId, videoId) {
  if (/^UC[\w-]{20,}$/.test(String(channelId||''))) return String(channelId);
  if (/^[\w-]{11}$/.test(String(videoId||''))) {
    const info = await client.getInfo(videoId);
    return String(info.basic_info?.channel_id || info.basic_info?.author_id || info.secondary_info?.owner?.author?.id || '');
  }
  return '';
}
app.get('/api/build', (_req,res)=>res.set('Cache-Control','no-store').json({build:'2.9.47'}));
app.get('/api/account/liked', async (req, res) => {
  try {
    const yt = await accountClient(req);
    const videos = await userCached(req, 'account:liked:v4', 60000, () => accountLikedVideos(yt));
    res.set('Cache-Control', 'no-store').json({ authenticated: true, source: 'google-account', videos });
  } catch (error) {
    console.error('Account liked videos:', error?.message || error);
    res.status(error?.status || 502).json({ authenticated: false, source: 'google-account', videos: [], error: 'Googleアカウントの高評価動画を取得できませんでした。' });
  }
});
app.get('/api/account/watch-later', async (req, res) => {
  try {
    const yt = await accountClient(req);
    const videos = await userCached(req, 'account:watch-later:v1', 60000, async () => {
      const library = await yt.getLibrary();
      const shelf = library?.watch_later;
      if (!shelf) return [];
      const feed = await shelf.getAll();
      const found = new Map();
      const add = items => {
        for (const item of items || []) {
          const video = normalizeVideo(item);
          if (video?.id && !found.has(video.id)) found.set(video.id, video);
        }
      };
      add(feed?.videos || shelf.contents);
      let current = feed;
      for (let page = 0; current?.has_continuation && page < 19 && found.size < 500; page++) {
        current = await current.getContinuation();
        add(current?.videos);
      }
      return [...found.values()].slice(0, 500);
    });
    const videoId = String(req.query.videoId || '');
    res.set('Cache-Control', 'no-store').json({
      authenticated: true,
      source: 'google-account',
      videos,
      ...(videoId ? { saved: videos.some(video => video.id === videoId) } : {})
    });
  } catch (error) {
    console.error('Account watch later:', error?.message || error);
    res.status(error?.status || 502).json({ authenticated: false, source:'google-account', videos:[], error:'Googleアカウントの「後で見る」を取得できませんでした。' });
  }
});
app.post('/api/account/watch-later', async (req, res) => {
  const videoId = String(req.body?.videoId || '');
  const action = String(req.body?.action || '');
  if (!/^[\w-]{11}$/.test(videoId) || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ authenticated:false, error:'後で見るの操作内容が不正です。' });
  }
  try {
    const yt = await accountClient(req);
    if (action === 'add') await yt.playlist.addVideos('WL', [videoId]);
    else await yt.playlist.removeVideos('WL', [videoId]);
    memory.delete(`user:${req.wetubeSessionId}:account:watch-later:v1`);
    res.set('Cache-Control', 'no-store').json({ authenticated:true, ok:true, saved:action === 'add' });
  } catch (error) {
    console.error('Update account watch later:', error?.message || error);
    res.status(error?.status || 502).json({ authenticated:false, ok:false, error:'Googleアカウントの「後で見る」を更新できませんでした。' });
  }
});
app.get('/api/account/subscriptions', async (req, res) => {
  try { const yt=await accountClient(req), channels=await accountSubscribedChannels(yt); res.set('Cache-Control','no-store').json({authenticated:true,source:'google-account',channels}); }
  catch(error){console.error('Account subscriptions:',error?.message||error);res.status(error?.status||502).json({authenticated:false,source:'google-account',channels:[],error:'Googleアカウントの登録チャンネルを取得できませんでした。'});}
});
app.get('/api/account/history', async (req, res) => {
  try {
    const yt = await accountClient(req);
    const feed = await accountWatchHistoryFeed(yt);
    const historyPage = {
      feed,
      seen: new Set(),
      pending: normalizeAccountHistoryFeed(feed, 500)
    };
    const { videos, hasMore } = await nextAccountHistoryPage(historyPage, 120);
    if (!videos.length) {
      const sections = Array.from(feed.sections || []).map(section => ({
        type: String(section?.type || section?.constructor?.type || section?.constructor?.name || ''),
        entries: Array.from(section?.contents || []).map(item => String(item?.type || item?.constructor?.type || item?.constructor?.name || 'unknown')).slice(0, 20)
      }));
      const grids = Array.from(feed.memo?.getType?.(YTNodes.Grid) || []).map(grid => ({
        items: Array.from(grid?.items || []).slice(0, 20).map(item => ({
          type: String(item?.type || item?.constructor?.type || 'unknown'),
          contentType: String(item?.content_type || ''),
          hasId: Boolean(item?.content_id || item?.video_id || item?.id)
        }))
      }));
      console.warn(`Account watch history [${req.wetubeSessionId.slice(0,8)}]: no video entries parsed`, {
        sections,
        grids,
        feedVideos: Array.from(feed.videos || []).length,
        memoTypes: feed.memo instanceof Map ? Array.from(feed.memo.keys()).slice(0, 40) : []
      });
    }
    const cursor = hasMore
      ? makeAccountHistorySession(req.wetubeSessionId, historyPage.feed, {
        seen: [...historyPage.seen],
        pending: historyPage.pending
      })
      : '';
    console.info(`Account watch history [${req.wetubeSessionId.slice(0,8)}]: ${videos.length} videos (${videos.filter(video => video.isShort).length} Shorts), hasMore=${hasMore}`);
    res.set('Cache-Control', 'no-store').json({
      authenticated: true,
      source: 'google-account',
      videos,
      hasMore,
      cursor
    });
  }
  catch(error){console.error(`Account watch history [${req.wetubeSessionId.slice(0,8)}]:`,error);res.status(error?.status||(/AUTH_REQUIRED|401/i.test(String(error?.message||''))?401:502)).set('Cache-Control','no-store').json({authenticated:false,source:'google-account',videos:[],error:'Googleアカウントの視聴履歴を取得できませんでした。'});}
});
app.post('/api/account/history/next', async (req, res) => {
  const session = getAccountHistorySession(req.body?.cursor, req.wetubeSessionId);
  if (!session) return res.status(410).set('Cache-Control', 'no-store').json({ authenticated:false, error:'視聴履歴の続きが期限切れです。履歴ページを更新してください。' });
  try {
    await accountClient(req);
    const result = await nextAccountHistoryPage(session);
    const cursor = result.hasMore ? String(req.body.cursor) : '';
    if (!result.hasMore) accountHistorySessions.delete(cursor);
    console.info(`Account history continuation [${req.wetubeSessionId.slice(0,8)}]: ${result.videos.length} videos, hasMore=${result.hasMore}`);
    return res.set('Cache-Control', 'no-store').json({ authenticated:true, source:'google-account', ...result, cursor });
  } catch (error) {
    console.error(`Account history continuation [${req.wetubeSessionId.slice(0,8)}]:`, error);
    return res.status(error?.status || 502).set('Cache-Control', 'no-store').json({
      authenticated:false,
      error:'Googleアカウントの視聴履歴を追加で読み込めませんでした。'
    });
  }
});
app.post('/api/account/history', async (req, res) => {
  const videoId=String(req.body?.videoId||'');
  const playbackSessionId=String(req.body?.playbackSessionId||'');
  if (!/^[\w-]{11}$/.test(videoId)) return res.status(400).json({error:'動画IDが不正です。'});
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playbackSessionId)) {
    return res.status(400).json({error:'再生セッションが不正です。'});
  }
  try {
    const yt=await accountClient(req);
    const key=`${req.wetubeSessionId}:${videoId}:${playbackSessionId}`;
    const result=await runWatchHistoryAddOnce(key, async () => {
      const response=await addVideoToAccountHistory(yt, videoId);
      if (response?.ok !== true) throw new Error(`WATCH_HISTORY_UPDATE_FAILED:${response?.status || 'unknown'}`);
      memory.delete(`user:${req.wetubeSessionId}:account:history:v3`);
      try {
        const latest=await accountWatchHistoryLatest(yt);
        return latest[0]?.id === videoId
          ? {ok:true,verified:true}
          : {accepted:true,verified:false};
      } catch(error) {
        console.warn('Watch history accepted but could not be verified:',error?.message||error);
        return {accepted:true,verified:false};
      }
    });
    return res.status(result.accepted ? 202 : 200).set('Cache-Control','no-store').json(result);
  } catch(error) {
    const status=error?.status||(/AUTH_REQUIRED|401/i.test(String(error?.message||''))?401:502);
    console.error('Add video to account history:',error?.message||error);
    res.status(status).json({error:'動画をGoogleアカウントの視聴履歴に追加できませんでした。'});
  }
});
app.get('/api/account/video-state', async (req,res) => {
  try {
    const yt=await accountClient(req), videoId=String(req.query.id||'');
    if (!/^[\w-]{11}$/.test(videoId)) return res.status(400).json({authenticated:false,liked:false,error:'動画IDが不正です。'});
    const rating=await accountVideoRatingStatus(yt,videoId);
    res.set('Cache-Control','no-store').json({authenticated:true,liked:rating==='LIKE',disliked:rating==='DISLIKE'});
  } catch(error){console.error('Account video rating state:',error?.message||error);res.status(error?.status||502).json({authenticated:false,liked:false,error:'高評価状態を取得できませんでした。'});}
});
app.get('/api/account/channel-state', async (req,res) => {
  try {
    const yt=await accountClient(req), channelId=String(req.query.id||'');
    if (!/^UC[\w-]{20,}$/.test(channelId)) return res.status(400).json({authenticated:false,error:'チャンネルIDが不正です。'});
    const subscribed=await accountChannelSubscriptionStatus(yt,channelId);
    res.set('Cache-Control','no-store').json({authenticated:true,subscribed});
  } catch(error){res.status(error?.status||502).json({authenticated:false,subscribed:false,error:'登録状態を取得できませんでした。'});}
});

app.post('/api/interact', async (req,res) => {
  const body=req.body||{}, action=String(body.action||''), videoId=String(body.videoId||'');
  try {
    const yt=await accountClient(req);
    let result;
    // The generic InteractionManager synthesizes a likeEndpoint that currently
    // receives HTTP 400. VideoInfo uses YouTube's actual endpoint from /next.
    if (action==='like' && /^[\w-]{11}$/.test(videoId)) {
      memory.delete(`user:${req.wetubeSessionId}:account:liked:v4`);
      result=await executeVideoRating(yt,videoId,'LIKE');
    }
    else if (action==='dislike' && /^[\w-]{11}$/.test(videoId)) {
      memory.delete(`user:${req.wetubeSessionId}:account:liked:v4`);
      result=await executeVideoRating(yt,videoId,'DISLIKE');
    }
    else if (action==='removeRating' && /^[\w-]{11}$/.test(videoId)) {
      memory.delete(`user:${req.wetubeSessionId}:account:liked:v4`);
      result=await executeVideoRating(yt,videoId,'INDIFFERENT');
    }
    else if (action==='comment' && /^[\w-]{11}$/.test(videoId)) {
      const value=String(body.text||'').trim();
      if(!value)return res.status(400).json({error:'コメントを入力してください。'});
      result=await yt.interact.comment(videoId,value);
    }
    else {
      const channelId=await accountChannelId(yt,body.channelId,videoId);
      if(!/^UC[\w-]{20,}$/.test(channelId)) return res.status(400).json({error:'チャンネルIDを取得できませんでした。'});
      if (!['subscribe','unsubscribe','notification'].includes(action)) return res.status(400).json({error:'操作が不正です。'});
      if (action==='subscribe' || action==='unsubscribe') {
        memory.delete(`user:${req.wetubeSessionId}:account:subscriptions:v3`);
        result=await executeChannelSubscription(yt,channelId,action==='subscribe');
        memory.delete(`user:${req.wetubeSessionId}:account:subscriptions:v3`);
        return res.set('Cache-Control','no-store').json({
          ok:true,
          action,
          subscribed:result.subscribed,
          ...(result.unchanged?{unchanged:true}:{})
        });
      }
      const wasSubscribed=await accountChannelSubscriptionStatus(yt,channelId);
      if(action==='notification') result=await yt.interact.setNotificationPreferences(channelId,String(body.preference||'PERSONALIZED').toUpperCase());
      if (result?.success !== true) {
        const error = new Error(`INTERACTION_REQUEST_FAILED:${result?.status_code || 'unknown'}`);
        error.status = result?.status_code || 502;
        throw error;
      }
      return res.set('Cache-Control','no-store').json({ok:true,action,subscribed:wasSubscribed});
    }
    if (['comment','notification'].includes(action) && result?.success !== true) {
      const error = new Error(`INTERACTION_REQUEST_FAILED:${result?.status_code || 'unknown'}`);
      error.status = result?.status_code || 502;
      throw error;
    }
    const rating=['like','dislike','removeRating'].includes(action)?result.ratingStatus:undefined;
    res.set('Cache-Control','no-store').json({ok:true,action,...(rating?{liked:rating==='LIKE',disliked:rating==='DISLIKE'}:{})});
  } catch(error) {
    const message=String(error?.message||error), status=error?.status||(/signed in|AUTH_REQUIRED|401/i.test(message)?401:/403|forbidden|disabled/i.test(message)?403:/429|rate|quota/i.test(message)?429:502);
    console.error('Account interaction:',{action,message,status});
    const errorMessage=status===401?'この操作にはGoogleアカウントへのログインが必要です。'
      :message.includes('SUBSCRIPTION_STATE_MISMATCH')?'YouTube側でチャンネル登録状態の更新を確認できませんでした。'
        :message.includes('RATING_STATE_MISMATCH')?'YouTube側で高評価状態の更新を確認できませんでした。'
          :message.includes('already liked')?'この動画はすでに高評価済みです。'
            :message.includes('RATING_ENDPOINT_NOT_FOUND')||message.includes('not found')||message.includes("reading 'as'")?'この動画の高評価操作情報を取得できませんでした。'
              :`YouTubeへの操作に失敗しました: ${message.slice(0,160)}`;
    res.status(status).json({error:errorMessage});
  }
});

async function fetchAwakestStreams(videoId) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://awakest.net/youtube-video-downloader/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      body: new URLSearchParams({ yotuurl: youtubeUrl }),
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`AWAKEST_HTTP_${response.status}`);
    const html = await response.text();
    const decodeHtml = value => String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&#038;/gi, '&')
      .replace(/&#x26;/gi, '&')
      .replace(/\\\//g, '/');
    const candidates = [];
    const urlPattern = /https?:\/\/(?:redirector\.)?googlevideo\.com\/videoplayback\?[^\s"'<>]+/gi;
    for (const match of html.matchAll(urlPattern)) {
      const url = decodeHtml(match[0]);
      try {
        const parsed = new URL(url);
        if (parsed.hostname.endsWith('googlevideo.com') && parsed.pathname === '/videoplayback') candidates.push(parsed.href);
      } catch {}
    }
    const urls = [...new Set(candidates)];
    if (!urls.length) throw new Error('AWAKEST_STREAM_NOT_FOUND');
    return urls.map(url => {
      const parsed = new URL(url);
      const itag = Number(parsed.searchParams.get('itag') || 0);
      const mimeType = parsed.searchParams.get('mime') || '';
      const duration = Number(parsed.searchParams.get('dur') || 0);
      return {
        url,
        itag: Number.isFinite(itag) ? itag : 0,
        mimeType,
        duration,
        expires: Number(parsed.searchParams.get('expire') || 0),
        source: 'awakest'
      };
    }).sort((a, b) => b.itag - a.itag);
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/stream-info', async (req, res) => {
  const id = String(req.query.v || '');
  if (!/^[\w-]{11}$/.test(id)) return res.status(400).json({ error: '動画IDが不正です。' });
  try {
    const [streams, info] = await Promise.all([
      fetchAwakestStreams(id),
      cached(`basic:stream:${id}`, 300000, () => youtubePromise.then(yt => yt.getBasicInfo(id)))
    ]);
    const title = text(info?.basic_info?.title, '');
    res.set('Cache-Control', 'no-store').json({ id, title, source: 'awakest', formats: streams });
  } catch (error) {
    console.error('Awakest stream extraction:', error?.message || error);
    res.status(502).json({ error: 'awakest.net からストリームURLを取得できませんでした。' });
  }
});

const commentContinuations = new Map();
const commentContinuationTtl = 10 * 60 * 1000;
function rememberCommentContinuation(feed, videoId, sort) {
  const now = Date.now();
  for (const [token, entry] of commentContinuations) {
    if (entry.expiresAt <= now) commentContinuations.delete(token);
  }
  while (commentContinuations.size >= 200) {
    commentContinuations.delete(commentContinuations.keys().next().value);
  }
  const token = randomUUID();
  commentContinuations.set(token, { feed, videoId, sort, expiresAt:now + commentContinuationTtl });
  return token;
}
app.get('/api/comments', async (req,res) => {
  const videoId=String(req.query.v||'');
  if (!/^[\w-]{11}$/.test(videoId)) return res.status(400).json({error:'動画IDが不正です。'});
  let timeout;
  try {
    const sort=req.query.sort==='new'?'NEWEST_FIRST':'TOP_COMMENTS';
    const feedPromise = youtubePromise.then(yt => yt.getComments(videoId,sort));
    const feed = await Promise.race([
      feedPromise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Object.assign(new Error('COMMENTS_TIMEOUT'), { status:504 })), 20000); })
    ]);
    const comments = collectComments(feed);
    const continuationToken = feed.has_continuation ? rememberCommentContinuation(feed, videoId, sort) : '';
    res.set('Cache-Control','no-store').json({ comments, continuationToken, hasMore:Boolean(continuationToken) });
  } catch(error) {
    console.error('Load video comments:',error?.message||error);
    res.status(error?.status === 504 ? 504 : 502).set('Cache-Control','no-store').json({error:error?.status === 504 ? 'コメントの読み込みに時間がかかっています。時間をおいて再試行してください。' : 'コメントを取得できませんでした。'});
  } finally {
    clearTimeout(timeout);
  }
});
app.post('/api/comments/next', async (req,res) => {
  const token = String(req.body?.token || '');
  const entry = commentContinuations.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (token) commentContinuations.delete(token);
    return res.status(410).set('Cache-Control','no-store').json({ error:'コメントの続きの有効期限が切れました。並び順を更新してください。' });
  }
  let timeout;
  try {
    const feed = await Promise.race([
      entry.feed.getContinuation(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Object.assign(new Error('COMMENTS_TIMEOUT'), { status:504 })), 20000); })
    ]);
    entry.feed = feed;
    entry.expiresAt = Date.now() + commentContinuationTtl;
    const comments = collectComments(feed);
    const continuationToken = feed.has_continuation ? token : '';
    if (!continuationToken) commentContinuations.delete(token);
    return res.set('Cache-Control','no-store').json({ comments, continuationToken, hasMore:Boolean(continuationToken) });
  } catch (error) {
    console.error('Load next video comments:',error?.message||error);
    return res.status(error?.status === 504 ? 504 : 502).set('Cache-Control','no-store').json({
      error:error?.status === 504 ? 'コメントの読み込みに時間がかかっています。下へスクロールして再試行してください。' : 'コメントを追加で取得できませんでした。'
    });
  } finally {
    clearTimeout(timeout);
  }
});
const commentReplyContinuations = new Map();
function rememberCommentReplyContinuation(endpoint, videoId, commentId) {
  const now = Date.now();
  for (const [token, entry] of commentReplyContinuations) {
    if (entry.expiresAt <= now) commentReplyContinuations.delete(token);
  }
  while (commentReplyContinuations.size >= 200) {
    commentReplyContinuations.delete(commentReplyContinuations.keys().next().value);
  }
  const token = randomUUID();
  commentReplyContinuations.set(token, { endpoint, videoId, commentId, expiresAt:now + 5 * 60 * 1000 });
  return token;
}
app.get('/api/comment-replies', async (req,res) => {
  const videoId = String(req.query.v || '');
  const commentId = String(req.query.commentId || '');
  if (!/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error:'動画IDが不正です。' });
  if (!/^[\w.-]{10,160}$/.test(commentId)) return res.status(400).json({ error:'コメントIDが不正です。' });
  try {
    const yt = await youtubePromise;
    const token = String(req.query.continuation || '');
    let endpoint;
    if (token) {
      const entry = commentReplyContinuations.get(token);
      if (!entry || entry.expiresAt <= Date.now()) {
        commentReplyContinuations.delete(token);
        return res.status(410).json({ error:'返信の続きの有効期限が切れました。もう一度返信を開いてください。' });
      }
      if (entry.videoId !== videoId || entry.commentId !== commentId) return res.status(400).json({ error:'返信の続きがコメントと一致しません。' });
      commentReplyContinuations.delete(token);
      endpoint = entry.endpoint;
    } else {
      const sort = req.query.sort === 'new' ? 'NEWEST_FIRST' : 'TOP_COMMENTS';
      const feed = await yt.getComments(videoId, sort, commentId);
      const thread = Array.from(feed.contents || []).find(item => item.comment?.comment_id === commentId);
      if (!thread) return res.status(404).json({ error:'コメントが見つかりません。並び順を更新して再試行してください。' });
      if (!Number(thread.comment?.reply_count || 0)) return res.set('Cache-Control', 'no-store').json({ replies:[], hasMore:false });

      const replyData = thread.comment_replies_data;
      const loaded = Array.from(replyData?.contents || []).filter(item => item.type === 'CommentView')
        .map(item => normalizeCommentView(item)).filter(Boolean);
      if (loaded.length) return res.set('Cache-Control', 'no-store').json({ replies:loaded, hasMore:false });

      const continuation = [
        ...Array.from(replyData?.sub_threads || []),
        ...Array.from(replyData?.contents || [])
      ].find(item => item.type === 'ContinuationItem');
      endpoint = continuation?.button?.endpoint || continuation?.endpoint;
    }
    if (!endpoint) return res.status(502).json({ error:'このコメントの返信を取得できませんでした。' });
    const response = await endpoint.call(yt.actions, { parse:true });
    const action = Array.from(response.on_response_received_endpoints || [])
      .find(item => item.type === 'AppendContinuationItemsAction');
    const entries = Array.from(action?.contents || []);
    const replies = entries.filter(item => item.type === 'CommentView')
      .map(item => normalizeCommentView(item)).filter(Boolean);
    const nextContinuation = entries.find(item => item.type === 'ContinuationItem');
    const nextEndpoint = nextContinuation?.button?.endpoint || nextContinuation?.endpoint;
    const continuationToken = nextEndpoint ? rememberCommentReplyContinuation(nextEndpoint, videoId, commentId) : '';
    res.set('Cache-Control', 'no-store').json({ replies, hasMore:Boolean(continuationToken), continuationToken });
  } catch (error) {
    console.error('Load comment replies:', error?.message || error);
    res.status(502).json({ error:'コメントの返信を取得できませんでした。' });
  }
});
app.get('/api/suggestions', async (req,res) => {
  try {
    const yt=await youtubePromise;
    const url=new URL('https://suggestqueries.google.com/complete/search');
    for (const [key,value] of Object.entries({
      client:'youtube',gs_ri:'youtube',gs_id:'0',cp:'0',ds:'yt',
      hl:yt.session.context.client.hl,
      gl:yt.session.context.client.gl,q:String(req.query.q||'').slice(0,100)
    }))url.searchParams.set(key,value);
    const response=await yt.session.http.fetch_function(url,{headers:{Cookie:yt.session.cookie||''}});
    if(!response.ok)throw new Error(`SUGGESTIONS_HTTP_${response.status}`);
    const bytes=await response.arrayBuffer();
    const charset=response.headers.get('content-type')?.match(/charset=([^;\s]+)/i)?.[1]||'utf-8';
    const decoded=new TextDecoder(charset).decode(bytes).trim();
    const json=decoded.replace(/^window\.google\.ac\.h\(/,'').replace(/\);?\s*$/,'');
    const payload=JSON.parse(json);
    const suggestions=(Array.isArray(payload?.[1])?payload[1]:[]).map(item=>String(item?.[0]||'')).filter(Boolean).slice(0,8);
    res.set('Cache-Control','private,max-age=60').json({suggestions});
  } catch(error) {
    console.error('Search suggestions:',error?.message||error);
    res.status(502).json({suggestions:[],error:'検索候補を取得できませんでした。'});
  }
});
app.use((req,res)=>{
  if (req.path.startsWith('/api/')) return res.status(404).set('Cache-Control','no-store').json({error:'API endpoint not found.'});
  res.redirect('/');
});
app.use((error,_req,res,next)=>{
  if (res.headersSent) return next(error);
  const youtubeBlocked = /status code 403\b/i.test(String(error?.message || ''));
  if (youtubeBlocked) console.warn('YouTube API request was blocked (HTTP 403); the server may be temporarily restricted.');
  else console.error(error);
  res.status(youtubeBlocked ? 503 : 500);
  render(res,{
    page:'error',
    title:'エラー',
    error:youtubeBlocked
      ? 'YouTube側でこのサーバーからの通信が制限されています。時間をおいて再試行してください。'
      : '動画データを取得できませんでした。少し待ってから再読み込みしてください。'
  });
});
app.listen(PORT,()=>console.log(`WeTube: http://localhost:${PORT}`));
