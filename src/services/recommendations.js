export function createRecommendationService({
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
}) {
  async function enrichAuthorThumbnails(client, videos) {
    const lookupClient = await youtubePromise;
    // Author metadata is supplementary. Fetch it in small parallel batches so
    // the recommendation request is not serialized behind an artificial delay.
    const targets = videos.filter(video => video && video.id && (!video.authorThumbnail || !video.authorId || !video.author || video.author === 'YouTube')).slice(0, 32);
    const infoCache = new Map();
    for (let offset = 0; offset < targets.length; offset += 8) {
      await Promise.all(targets.slice(offset, offset + 8).map(async video => {
        try {
          const info = await cached(`home-author-info-v3:${video.id}`, 900000, () => lookupClient.getBasicInfo(video.id));
          const b = info?.basic_info || info?.basicInfo || {};
          const channel = b.channel || {};
          const channelId = b.channel_id || b.channelId || channel.id || video.authorId || '';
          const channelName = text(b.author || b.channel_name || b.channelName || channel.name, '');
          const owner = info?.secondary_info?.owner?.author || info?.secondary_info?.owner || {};
          const avatar = proxied(
            channel?.thumbnail?.at?.(-1)?.url ||
            channel?.thumbnails?.at?.(-1)?.url ||
            owner?.best_thumbnail?.url ||
            owner?.thumbnails?.at?.(-1)?.url ||
            rawImage(channel) ||
            rawImage(owner)
          );
          if (channelId) video.authorId = String(channelId);
          if (channelName && (video.author === 'YouTube' || !video.author)) video.author = channelName;
          if (avatar) video.authorThumbnail = avatar;
          infoCache.set(video.id, true);
        } catch {}
      }));
    }
    const channelIds = [...new Set(videos.map(video => video.authorId).filter(id => /^UC[\w-]{20,}$/.test(String(id || ''))))].slice(0, 60);
    await Promise.all(channelIds.map(async id => {
      try {
        const channel = await cached(`home-channel:${id}`, 900000, () => lookupClient.getChannel(id));
        const meta = channel?.metadata || {};
        const header = channel?.header || {};
        const hc = header?.content || {};
        const avatarSources = hc?.image?.avatar?.image || hc?.image?.avatar?.thumbnails || [];
        const avatarUrl = (Array.isArray(avatarSources) ? avatarSources.at(-1)?.url : '') || rawImage(meta) || rawImage(header) || rawImage(channel);
        const avatar = proxied(avatarUrl);
        const name = text(meta.title || header.page_title || hc.title?.text || hc.title, '');
        for (const video of videos.filter(item => item.authorId === id)) {
          if (avatar) video.authorThumbnail = avatar;
          if (name && (video.author === 'YouTube' || !video.author)) video.author = name;
        }
      } catch {}
    }));
    const missing = videos.filter(video => !video.authorThumbnail && video.author && video.author !== 'YouTube');
    const names = [...new Set(missing.map(video => video.author))].slice(0, 30);
    const resolved = new Map();
    await Promise.all(names.map(async name => {
      try {
        const result = await cached(`channel-search:${name}`, 900000, () => lookupClient.search(name, { type: 'channel' }));
        const channels = collectChannels(result, 8);
        const match = channels.find(channel => channel.name === name) || channels[0];
        if (match?.thumbnail) resolved.set(name, match.thumbnail);
        if (match?.id) for (const video of missing.filter(v => v.author === name)) video.authorId ||= match.id;
      } catch {}
    }));
    for (const video of missing) if (resolved.has(video.author)) video.authorThumbnail = resolved.get(video.author);
    const stillMissing = videos.filter(video => (!video.authorThumbnail || !video.author || video.author === 'YouTube') && video.authorId).slice(0, 30);
    for (let index = 0; index < stillMissing.length; index += 4) {
      await Promise.all(stillMissing.slice(index, index + 4).map(async video => {
        try {
          const response = await fetch(`http://127.0.0.1:${PORT}/channel/${encodeURIComponent(video.authorId)}?tab=about`, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) return;
          const html = await response.text();
          const image = html.match(/class="channel-avatar-xl"[^>]*src="([^"]+)"/)?.[1] || '';
          const name = html.match(/<h1>([^<]+)<\/h1>/)?.[1] || '';
          if (image) video.authorThumbnail = image;
          if (name && (video.author === 'YouTube' || !video.author)) video.author = name;
        } catch {}
      }));
    }
    return videos;
  }
  
  async function buildHomeRecommendations(client, limit = 50) {
    const feed = await client.getHomeFeed();
    const direct = normalizeFeedVideos(feed, Math.max(limit * 2, 80));
    let explicitShorts = collectShorts(feed, 32);
    if (explicitShorts.length < 8) {
      try {
        const result = await cached('home:shorts-fallback', 300000, () => client.search('Shorts', { type: 'video' }));
        const found = [...collectShorts(result, 24), ...collectVideos(result, 40).filter(video => video.isShort)];
        const seedless = await discoverSeedlessShorts(await youtubePromise, 16).catch(() => ({ videos: [] }));
        const ids = new Set(explicitShorts.map(video => video.id));
        explicitShorts = [...explicitShorts, ...[...found, ...(seedless.videos || [])].filter(video => !ids.has(video.id))];
      } catch {}
    }
    const all = [...direct, ...explicitShorts];
    const unique = new Map();
    for (const item of all) if (item?.id && !unique.has(item.id)) unique.set(item.id, item);
    const shorts = [...unique.values()].filter(item => item.isShort);
    const videos = [...unique.values()].filter(item => !item.isShort);
    await enrichAuthorThumbnails(client, [...videos, ...shorts]);
    return {
      videos: videos.slice(0, limit),
      shorts: shorts.slice(0, 16)
    };
  }
  
  async function getSignedInHomeVideos(req, limit = 50) {
    const client = await accountClient(req);
    if (!client.session.logged_in) return { videos: [], shorts: [] };
    let feed = await client.getHomeFeed();
    let videos = normalizeFeedVideos(feed, Math.max(limit * 2, 80));
    let shorts = collectShorts(feed, 32);
    // HomeFeed#getContinuation() is the documented way to retrieve the next
    // batch. Use one continuation when the first page is sparse.
    if (videos.length < Math.min(20, limit) && feed?.has_continuation && typeof feed.getContinuation === 'function') {
      try {
        feed = await feed.getContinuation();
        const next = normalizeFeedVideos(feed, Math.max(limit * 2, 80));
        const ids = new Set(videos.map(video => video.id));
        videos.push(...next.filter(video => !ids.has(video.id)));
        const shortIds = new Set(shorts.map(video => video.id));
        shorts.push(...collectShorts(feed, 32).filter(video => !shortIds.has(video.id)));
      } catch (error) { console.warn('Authenticated home continuation:', error?.message || error); }
    }
    if (shorts.length < 8) {
      try {
        const result = await userCached(req, 'home:shorts-fallback', 300000, () => client.search('Shorts', { type: 'video' }));
        const found = [...collectShorts(result, 24), ...collectVideos(result, 40).filter(video => video.isShort)];
        const seedless = await discoverSeedlessShorts(await youtubePromise, 16).catch(() => ({ videos: [] }));
        const ids = new Set(shorts.map(video => video.id));
        shorts.push(...[...found, ...(seedless.videos || [])].filter(video => !ids.has(video.id)));
      } catch {}
    }
    const all = [...videos, ...shorts];
    const unique = new Map();
    for (const item of all) if (item?.id && !unique.has(item.id)) unique.set(item.id, item);
    const outputVideos = [...unique.values()].filter(item => !item.isShort).slice(0, limit);
    const outputShorts = [...unique.values()].filter(item => item.isShort).slice(0, 16);
    await enrichAuthorThumbnails(client, [...outputVideos, ...outputShorts]);
    return { videos: outputVideos, shorts: outputShorts };
  }

  return { enrichAuthorThumbnails, buildHomeRecommendations, getSignedInHomeVideos };
}

