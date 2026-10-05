export function createShortsService({ youtubePromise, eduParams, walkRaw, text, proxied }) {
  const shortSessions = new Map();
  const shortSessionTtl = 30 * 60 * 1000;

  
  function makeShortSession(feed, { channelId = '', channelTitle = '', seen = [], mode = 'feed', seedId = '' } = {}) {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    shortSessions.set(token, { feed, channelId, channelTitle, seen: new Set(seen), mode, seedId, expires: Date.now() + shortSessionTtl });
    return token;
  }
  function shortInfoToVideo(info) {
    const b = info?.basic_info || {};
    const thumb = Array.isArray(b.thumbnail) ? b.thumbnail.at(-1)?.url : '';
    return { id:String(b.id || ''), title:text(b.title, 'ショート'), isShort:true, author:text(b.author || b.channel?.name, 'YouTube'), authorId:String(b.channel_id || b.channel?.id || ''), authorThumbnail:'', thumbnail:proxied(thumb) || proxied(`https://i.ytimg.com/vi/${b.id}/frame0.jpg`), duration:b.duration ? `${b.duration}s` : '', views:b.view_count ? Number(b.view_count).toLocaleString('ja-JP') + ' 回視聴' : '', published:'', description:text(b.short_description, '') };
  }
  async function discoverSeedlessShorts(yt, limit = 24) {
    const endpoint = await yt.resolveURL('https://www.youtube.com/shorts');
    const response = await endpoint.call(yt.session.actions);
    const root = response?.data || response;
    const ids = [];
    walkRaw(root, node => {
      const id = node?.reelWatchEndpoint?.videoId || node?.reel_watch_endpoint?.videoId || node?.videoId;
      if (/^[\w-]{11}$/.test(String(id || '')) && !ids.includes(String(id))) ids.push(String(id));
    }, 24);
    const seed = ids[0];
    if (!seed) return { videos: [], seedId: '' };
    const info = await yt.getShortsVideoInfo(seed);
    const sequenceIds = [seed, ...Array.from(info.watch_next_feed || []).map(endpoint => endpoint?.payload?.videoId).filter(id => /^[\w-]{11}$/.test(String(id || '')))];
    const unique = [...new Set(sequenceIds)].slice(0, limit);
    const infos = await Promise.all(unique.map(id => yt.getBasicInfo(id).catch(() => null)));
    return { videos:infos.map(shortInfoToVideo).filter(video => /^[\w-]{11}$/.test(video.id)), seedId:unique.at(-1) || seed };
  }
  function getShortSession(token) {
    const session = shortSessions.get(String(token || ''));
    if (!session || session.expires < Date.now()) { if (token) shortSessions.delete(String(token)); return null; }
    session.expires = Date.now() + shortSessionTtl;
    return session;
  }
  function prepareShorts(items, params, session) {
    return items.filter(Boolean).map(video => ({
      ...video,
      isShort: true,
      author: session?.channelTitle || video.author || 'YouTube',
      authorId: session?.channelId || video.authorId || '',
      eduUrl: `https://www.youtubeeducation.com/embed/${video.id}${params}`
    }));
  }

  return { makeShortSession, shortInfoToVideo, discoverSeedlessShorts, getShortSession, prepareShorts };
}

