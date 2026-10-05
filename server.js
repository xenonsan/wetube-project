
import express from 'express';
import compression from 'compression';
import { Innertube, UniversalCache } from 'youtubei.js';
import { createAuthService } from './src/auth.js';
import { memory, cached, userCached, eduParams, eduParamSources } from './src/cache.js';
import {
  youtubePromise, isImageHost, text, rawImage, proxied,
  normalizeShort, collectShorts, normalizeVideo, collectVideos,
  collectPlaylists, collectChannels, normalizeFeedVideos, numericViews
} from './src/youtube/media.js';
import {
  executeVideoRating, walkRaw, accountLikedVideos, accountSubscribedChannels
} from './src/youtube/raw.js';
import { createRecommendationService } from './src/services/recommendations.js';
import { createShortsService } from './src/services/shorts.js';

const app = express();
const PORT = Number(process.env.PORT || 4646);
const EDU_CONFIG = 'https://raw.githubusercontent.com/siawaseok3/wakame/master/video_config.json';

const auth = createAuthService({
  app,
  Innertube,
  UniversalCache,
  authRoot: new URL('./.wetube-auth', import.meta.url).pathname,
  text,
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
  getShortSession, prepareShorts
} = createShortsService({
  youtubePromise,
  eduParams: () => eduParams(EDU_CONFIG),
  walkRaw,
  text,
  proxied
});

const {
  enrichAuthorThumbnails, buildHomeRecommendations, getSignedInHomeVideos
} = createRecommendationService({
  youtubePromise,
  cached,
  userCached,
  collectVideos,
  collectShorts,
  normalizeFeedVideos,
  discoverSeedlessShorts,
  accountClient,
  text,
  proxied,
  rawImage,
  PORT
});


app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', new URL('./views', import.meta.url).pathname);
app.use(compression());
app.use(express.json({ limit: '64kb' }));
for (const [route, file, type] of [['/style.css','style.css','text/css'],['/watch.css','watch.css','text/css'],['/app.js','app.js','application/javascript']]) {
  app.get(route, (_req, res) => res.type(type).set('Cache-Control', 'public,max-age=86400').sendFile(new URL(`./public/${file}`, import.meta.url).pathname));
}

function render(res, data) { res.render('app', { page: data.page, title: data.title || 'WeTube', videos: data.videos || [], shorts: data.shorts || [], video: data.video || null, query: data.query || '', eduUrl: data.eduUrl || '', eduSources: data.eduSources || [], youtubeUrl: data.youtubeUrl || '', playerMode: data.playerMode || 'edu', error: data.error || '', entity: data.entity || null, libraryType: data.libraryType || '', searchType: data.searchType || 'all', authenticated: Boolean(data.authenticated ?? false), channels: data.channels || [], channelContent: data.channelContent || { featured:null, uploads:[], shorts:[], playlists:[] }, shortSession: data.shortSession || '', shortChannelId: data.shortChannelId || '' }); }


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
    if (client.session.logged_in) state.status = 'signed_in';
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
    memory.delete(`user:${sid}:account:recommendations:v4`);
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
app.get('/search', async (req, res, next) => {
  const query = String(req.query.q || '').trim().slice(0, 100); if (!query) return res.redirect('/');
  const requested = String(req.query.type || 'all');
  const searchType = ['all','video','channel','playlist'].includes(requested) ? requested : 'all';
  try {
    const options = searchType === 'all' ? {} : { type: searchType };
    const result = await cached(`search:${searchType}:${query}`, 300000, () => youtubePromise.then(yt => yt.search(query, options)));
    render(res, { page: 'search', title: `${query} - 検索`, query, searchType, videos: searchType === 'channel' ? [] : collectVideos(result, 50), channels: searchType === 'video' || searchType === 'playlist' ? [] : collectChannels(result, 30) });
  } catch (e) { next(e); }
});

app.get(['/shorts', '/shorts/:id'], async (req, res, next) => {
  try {
    const yt = await youtubePromise;
    const targetId = String(req.params.id || '').trim();
    const channelId = String(req.query.channel || '').trim();
    const params = await eduParams(EDU_CONFIG);
    let feed = null, channelTitle = '', initial = [], mode = 'feed', seedId = '';

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
    const token = makeShortSession(feed, { channelId, channelTitle, seen: [...seen], mode, seedId });
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
    const client = await ensureAuthClient(req);
    if (client.session.logged_in) {
      try {
        const home = await userCached(req, 'account:recommendations:v4', 60000, () => getSignedInHomeVideos(req, 50));
        const videos = home.videos.map(video => ({ ...video, reasons: ['YouTubeアカウント'] }));
        const shorts = home.shorts.map(video => ({ ...video, reasons: ['Shorts'] }));
        return res.json({ videos, shorts, source:'account', authenticated:true, error:videos.length || shorts.length ? '' : 'YouTubeアカウントのホームフィードが空でした。' });
      } catch (error) {
        console.error(`Authenticated recommendations [${req.wetubeSessionId.slice(0,8)}]:`, error?.message || error);
        return res.status(502).json({ videos:[], shorts:[], source:'account', authenticated:true, error:'YouTubeアカウントのおすすめを取得できませんでした。' });
      }
    }
    const body=req.body||{}, searches=(Array.isArray(body.searches)?body.searches:[]).map(String).filter(Boolean).slice(0,8), subscriptions=(Array.isArray(body.subscriptions)?body.subscriptions:[]).filter(x=>x?.id).slice(0,10), watched=(Array.isArray(body.watched)?body.watched:[]).filter(x=>x&&/^[\w-]{11}$/.test(String(x.id))).sort((a,b)=>Number(b.seconds||0)-Number(a.seconds||0)).slice(0,8), excluded=new Set((body.exclude||[]).map(String)), pool=new Map();
    const add=(items,base,reason)=>items.forEach((item,index)=>{if(!item||excluded.has(item.id))return;const current=pool.get(item.id)||{...item,score:0,reasons:[]};current.score+=Math.max(1,base-index*.35);if(!current.reasons.includes(reason))current.reasons.push(reason);pool.set(item.id,current)});
    const yt=await youtubePromise;
    await Promise.all(searches.slice(0,5).map(async(term,index)=>{try{add(collectVideos(await cached(`recommend:search:${term}`,300000,()=>yt.search(term,{type:'video'})),18),22-index*1.5,'検索履歴')}catch{}}));
    await Promise.all(subscriptions.slice(0,6).map(async(channel,index)=>{try{const feed=await cached(`recommend:channel:${channel.id}`,300000,async()=>{const c=await yt.getChannel(channel.id);return c.has_videos?c.getVideos():c});add(collectVideos(feed,20),29-index,'登録チャンネル')}catch{}}));
    await Promise.all(watched.slice(0,5).map(async(entry,index)=>{try{const info=await cached(`info:${entry.id}`,900000,()=>yt.getInfo(entry.id));add(Array.from(info.watch_next_feed||[]).map(normalizeVideo).filter(Boolean),34+Math.min(16,Number(entry.seconds||0)/60)-index,'長時間視聴')}catch{}}));
    if(pool.size<24){try{add(collectVideos(await cached('home',120000,()=>yt.getHomeFeed()),40),9,'ホーム')}catch{try{add(collectVideos(await yt.search('人気 動画',{type:'video'}),40),8,'ホーム')}catch{}}}
    const ranked=[...pool.values()].sort((a,b)=>b.score-a.score).map(({score,reasons,...video})=>({...video,reasons}));
    const videos=ranked.filter(video=>!video.isShort).slice(0,40), shorts=ranked.filter(video=>video.isShort).slice(0,16);
    await enrichAuthorThumbnails(yt,[...videos,...shorts]);
    return res.json({videos,shorts,source:'local',authenticated:false});
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
        const authorThumbnail = proxied(channel.thumbnail?.at?.(-1)?.url || channel.thumbnails?.at?.(-1)?.url || owner.best_thumbnail?.url || owner.thumbnails?.at?.(-1)?.url || rawImage(owner));
        return { id, title: b.title || '動画', author, authorId, authorThumbnail, thumbnail: proxied(b.thumbnail?.at?.(-1)?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`), duration: b.duration ? `${Math.floor(Number(b.duration)/60)}:${String(Number(b.duration)%60).padStart(2,'0')}` : '', views: b.view_count ? Number(b.view_count).toLocaleString('ja-JP') + ' 回視聴' : '', published: b.publish_date || '' };
      } catch { return null; }
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
      b.channel?.thumbnail?.at?.(-1)?.url ||
      b.channel?.thumbnails?.at?.(-1)?.url ||
      info.secondary_info?.owner?.author?.best_thumbnail?.url ||
      info.secondary_info?.owner?.author?.thumbnails?.at?.(-1)?.url ||
      rawImage(info.secondary_info?.owner?.author || info.secondary_info?.owner)
    );
    // Video basic_info often omits the creator avatar. Resolve it from the
    // channel response and keep it cached instead of rendering a fake initial.
    if (!authorThumbnail && authorId) {
      try {
        const channel = await cached(`channel:avatar:${authorId}`, 3600000, () => yt.getChannel(authorId));
        authorThumbnail = proxied(
          channel.metadata?.avatar?.at?.(-1)?.url ||
          channel.metadata?.thumbnail?.at?.(-1)?.url ||
          rawImage(channel.header || channel.metadata)
        );
      } catch {}
    }
    const owner = info.secondary_info?.owner || {};
    const subscribers = text(owner.subscriber_count || owner.subscribers, '');
    let likeCount = '', shortLikeCount = '';
    walkRaw(info.primary_info, node => {
      if (node?.short_like_count && !shortLikeCount) shortLikeCount = String(node.short_like_count);
      if (node?.like_count && !likeCount) likeCount = typeof node.like_count === 'number' ? Number(node.like_count).toLocaleString('ja-JP') : String(node.like_count);
    });
    if (!shortLikeCount && likeCount) shortLikeCount = likeCount;

    const video = {
      id,
      title: b.title || '動画',
      author: b.author || b.channel?.name || 'YouTube',
      authorId,
      authorThumbnail,
      views: b.view_count ? Number(b.view_count).toLocaleString('ja-JP') + ' 回視聴' : '',
      published: b.publish_date || '',
      description: b.short_description || '',
      subscribers,
      likeCount: shortLikeCount || likeCount || '高評価'
    };
    let related = Array.from(info.watch_next_feed || []).map(normalizeVideo).filter(Boolean).filter(x => x.id !== id);
    if (related.length < 6) { try { const more = collectVideos(await yt.search([b.title, b.author].filter(Boolean).join(' '), { type: 'video' }), 30); const ids = new Set(related.map(x => x.id)); for (const item of more) if (item.id !== id && !ids.has(item.id)) { ids.add(item.id); related.push(item); } } catch {} }
    render(res, {
      page: 'watch',
      title: video.title,
      video,
      videos: related.slice(0, 24),
      playerMode: req.query.player === 'youtube' ? 'youtube' : 'edu',
      eduUrl: `https://www.youtubeeducation.com/embed/${id}${params}&enablejsapi=1`,
      eduSources: eduSources.map(source => ({ name: source.name, url: `https://www.youtubeeducation.com/embed/${id}${source.params}&enablejsapi=1` })),
      youtubeUrl: `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0&enablejsapi=1`
    });
  } catch (e) { next(e); }
});

app.get('/api/notifications', async (req, res) => {
  try {
    const authClient = await ensureAuthClient(req);
    const yt = await activeYouTube(req);
    let items = [];
    if (authClient.session.logged_in) {
      try {
        const subs = await userCached(req, 'account:subscriptions:v2', 60000, () => accountSubscribedChannels(authClient));
        if (subs && subs.length) {
          const sample = subs.slice(0, 4);
          const feeds = await Promise.all(sample.map(c => cached(`recommend:channel:${c.id}`, 300000, async () => {
            const ch = await yt.getChannel(c.id);
            return ch.has_videos ? ch.getVideos() : ch;
          }).catch(() => null)));
          for (const feed of feeds) {
            if (feed) items.push(...collectVideos(feed, 2));
          }
        }
      } catch {}
    }
    if (!items.length) {
      try {
        const trending = await cached('feed:trending', 300000, () => yt.getTrending ? yt.getTrending() : yt.search('急上昇', { type: 'video' }));
        items = collectVideos(trending, 8);
      } catch {
        items = [];
      }
    }
    const notifications = items.slice(0, 10).map(v => ({
      id: v.id,
      title: v.title,
      author: v.author,
      authorThumbnail: v.authorThumbnail,
      thumbnail: v.thumbnail,
      published: v.published || '新着',
      url: `/watch?v=${v.id}`
    }));
    res.set('Cache-Control', 'no-store').json({ notifications, authenticated: Boolean(authClient.session.logged_in) });
  } catch (err) {
    res.json({ notifications: [], authenticated: false });
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
    const thumb=list=>Array.isArray(list)?list.at(-1)?.url||'':'';
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
function collectComments(source) { const out = [], seen = new WeakSet(); function walk(n,d=0){ if(!n||d>10||out.length>=40)return; if(Array.isArray(n))return n.forEach(x=>walk(x,d+1)); if(typeof n!=='object'||seen.has(n))return; seen.add(n); const body=text(n.content_text||n.content||n.comment_text,''), author=text(n.author?.name||n.author||n.author_text,''); if(body&&author)out.push({body,author,avatar:proxied(rawImage(n.author||n)),published:text(n.published_time||n.published,''),likes:text(n.vote_count||n.like_count,''),replies:Number(n.reply_count||0)}); Object.values(n).forEach(x=>walk(x,d+1)); } walk(source); return out; }
async function accountChannelId(client, channelId, videoId) {
  if (/^UC[\w-]{20,}$/.test(String(channelId||''))) return String(channelId);
  if (/^[\w-]{11}$/.test(String(videoId||''))) {
    const info = await client.getInfo(videoId);
    return String(info.basic_info?.channel_id || info.basic_info?.author_id || info.secondary_info?.owner?.author?.id || '');
  }
  return '';
}
app.get('/api/build', (_req,res)=>res.set('Cache-Control','no-store').json({build:'2.9.0'}));
app.get('/api/account/liked', async (req, res) => {
  try { const yt=await accountClient(req), videos=await userCached(req,'account:liked:v2',60000,()=>accountLikedVideos(yt)); res.set('Cache-Control','no-store').json({authenticated:true,source:'google-account',videos}); }
  catch(error){console.error('Account liked videos:',error?.message||error);res.status(error?.status||502).json({authenticated:false,source:'google-account',videos:[],error:'Googleアカウントの高評価動画を取得できませんでした。'});}
});
app.get('/api/account/subscriptions', async (req, res) => {
  try { const yt=await accountClient(req), channels=await userCached(req,'account:subscriptions:v2',60000,()=>accountSubscribedChannels(yt)); res.set('Cache-Control','no-store').json({authenticated:true,source:'google-account',channels}); }
  catch(error){console.error('Account subscriptions:',error?.message||error);res.status(error?.status||502).json({authenticated:false,source:'google-account',channels:[],error:'Googleアカウントの登録チャンネルを取得できませんでした。'});}
});
app.get('/api/account/video-state', async (req,res) => {
  try {
    const yt=await accountClient(req), videoId=String(req.query.id||'');
    const response=await yt.actions.execute('/next',{videoId,client:'WEB'}), root=response?.data||response;
    let liked=false;
    walkRaw(root,node=>{const status=String(node.likeStatusEntity?.likeStatus||node.likeStatus||node.likeEndpoint?.status||'').replace('LIKE_STATUS_','').toUpperCase();if(status==='LIKE'||node.toggleButtonRenderer?.isToggled===true)liked=true;});
    res.set('Cache-Control','no-store').json({authenticated:true,liked});
  } catch(error){res.status(error?.status||502).json({authenticated:false,liked:false,error:'高評価状態を取得できませんでした。'});}
});
app.get('/api/account/channel-state', async (req,res) => {
  try {
    const yt=await accountClient(req), channelId=String(req.query.id||'');
    const response=await yt.actions.execute('/browse',{browseId:channelId,client:'WEB'}), root=response?.data||response;
    let subscribed=false;
    walkRaw(root,node=>{if(node.subscribeButtonRenderer?.subscribed===true||node.subscribeButtonViewModel?.subscribed===true||node.subscribeButtonViewModel?.subscribeButtonContent?.subscribeState?.subscribed===true||node.subscribeButtonViewModel?.unsubscribeButtonContent?.subscribeState?.subscribed===true||node.subscriptionStateEntity?.subscribed===true)subscribed=true;});
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
    if (action==='like' && /^[\w-]{11}$/.test(videoId)) result=await executeVideoRating(yt,videoId,'LIKE');
    else if (action==='removeRating' && /^[\w-]{11}$/.test(videoId)) result=await executeVideoRating(yt,videoId,'INDIFFERENT');
    else if (action==='comment' && /^[\w-]{11}$/.test(videoId)) { const value=String(body.text||'').trim(); if(!value)return res.status(400).json({error:'コメントを入力してください。'}); result=await yt.interact.comment(videoId,value); }
    else {
      const channelId=await accountChannelId(yt,body.channelId,videoId);
      if(!/^UC[\w-]{20,}$/.test(channelId)) return res.status(400).json({error:'チャンネルIDを取得できませんでした。'});
      if(action==='subscribe') result=await yt.interact.subscribe(channelId);
      else if(action==='unsubscribe') result=await yt.interact.unsubscribe(channelId);
      else if(action==='notification') result=await yt.interact.setNotificationPreferences(channelId,String(body.preference||'PERSONALIZED').toUpperCase());
      else return res.status(400).json({error:'操作が不正です。'});
    }
    if (['like','removeRating'].includes(action)) memory.delete(`user:${req.wetubeSessionId}:account:liked:v2`);
    if (['subscribe','unsubscribe','notification'].includes(action)) memory.delete(`user:${req.wetubeSessionId}:account:subscriptions:v2`);
    res.json({ok:true,action});
  } catch(error) {
    const message=String(error?.message||error), status=/signed in|AUTH_REQUIRED|401/i.test(message)?401:/403|forbidden|disabled/i.test(message)?403:/429|rate|quota/i.test(message)?429:502;
    console.error('Account interaction:',{action,message,status});
    res.status(status).json({error:message.includes('already liked')?'この動画はすでに高評価済みです。':message.includes('RATING_ENDPOINT_NOT_FOUND')||message.includes('not found')||message.includes("reading 'as'")?'この動画の高評価操作情報を取得できませんでした。':`YouTubeへの操作に失敗しました: ${message.slice(0,160)}`});
  }
});

app.get('/api/stream-info', async (req, res) => {
  const id = String(req.query.v || '');
  if (!/^[\w-]{11}$/.test(id)) return res.status(400).json({ error: '動画IDが不正です。' });
  try {
    const info = await (await activeYouTube(req)).getInfo(id);
    const streaming = info.streaming_data || info.streamingData || {};
    const formats = [...(streaming.formats || []), ...(streaming.adaptive_formats || streaming.adaptiveFormats || [])]
      .map(format => ({
        itag: format.itag,
        quality: format.quality_label || format.qualityLabel || format.quality || '',
        mimeType: format.mime_type || format.mimeType || '',
        bitrate: Number(format.bitrate || 0),
        hasAudio: Boolean(format.has_audio ?? format.audio_quality ?? format.audioQuality),
        hasVideo: Boolean(format.has_video ?? format.width ?? format.height),
        fps: Number(format.fps || 0)
      }))
      .filter(format => format.quality || format.mimeType)
      .sort((a, b) => (b.hasVideo - a.hasVideo) || (b.bitrate - a.bitrate));
    res.set('Cache-Control', 'no-store').json({ id, title: text(info.basic_info?.title, ''), formats });
  } catch (error) {
    console.error('Stream metadata:', error);
    res.status(502).json({ error: 'ストリーム情報を取得できませんでした。' });
  }
});

app.get('/api/comments', async (req,res) => { try { const sort=req.query.sort==='new'?'NEWEST_FIRST':'TOP_COMMENTS'; res.json({comments:collectComments(await (await youtubePromise).getComments(String(req.query.v||''),sort))}); } catch { res.json({comments:[]}); } });
app.get('/api/suggestions', async (req,res) => { try { res.json({suggestions:(await (await youtubePromise).getSearchSuggestions(String(req.query.q||''))).slice(0,8)}); } catch { res.json({suggestions:[]}); } });
app.get('/api/transcript', async (req,res) => { try { const info=await (await youtubePromise).getInfo(String(req.query.v||'')), transcript=await info.getTranscript(), lines=[], seen=new WeakSet(); function walk(n,d=0){if(!n||d>12||lines.length>500)return;if(Array.isArray(n))return n.forEach(x=>walk(x,d+1));if(typeof n!=='object'||seen.has(n))return;seen.add(n);const t=text(n.snippet?.text||n.text,'');if(t&&(n.start_ms!=null||n.start_time_ms!=null))lines.push({text:t,start:Number(n.start_ms||n.start_time_ms||0)});Object.values(n).forEach(x=>walk(x,d+1));} walk(transcript); res.json({transcript:lines}); } catch { res.json({transcript:[]}); } });
app.use((_req,res)=>res.redirect('/'));
app.use((error,_req,res,_next)=>{console.error(error);res.status(500);render(res,{page:'error',title:'エラー',error:'動画データを取得できませんでした。少し待ってから再読み込みしてください。'});});
app.listen(PORT,()=>console.log(`WeTube: http://localhost:${PORT}`));


