export function createRecommendationService({
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
}) {
  function memoItems(feed, NodeClass) {
    if (!feed?.memo || !NodeClass || typeof feed.memo.getType !== 'function') return [];
    try {
      return Array.from(feed.memo.getType(NodeClass) || []);
    } catch (error) {
      console.warn(`Recommendation memo lookup failed for ${NodeClass.name}:`, error?.message || error);
      return [];
    }
  }

  function homeMemos(feed) {
    return [
      feed?.memo,
      feed?.page?.contents_memo,
      feed?.page?.header_memo,
      feed?.page?.on_response_received_actions_memo,
      feed?.page?.on_response_received_endpoints_memo,
      feed?.page?.on_response_received_commands_memo,
      feed?.page?.sidebar_memo
    ].filter(Boolean);
  }

  function homeVideos(feed, limit) {
    const shortIds = new Set(homeShorts(feed, Math.max(limit, 40)).map(video => video.id));
    const direct = Array.from(feed?.videos || [])
      .map(normalizeVideo)
      .filter(video => video && !video.isShort && !shortIds.has(video.id));
    const classes = [YTNodes?.Video, YTNodes?.GridVideo, YTNodes?.CompactVideo, YTNodes?.LockupView, YTNodes?.Tile].filter(Boolean);
    const typedNodes = homeMemos(feed).flatMap(memo =>
      classes.flatMap(NodeClass => {
        try {
          return typeof memo.getType === 'function' ? Array.from(memo.getType(NodeClass) || []) : [];
        } catch (error) {
          console.warn(`Recommendation memo lookup failed for ${NodeClass.name}:`, error?.message || error);
          return [];
        }
      })
    );
    const memoVideos = collectVideos(typedNodes, limit * 2);
    const fallbackVideos = collectVideos([homeMemos(feed), feed], Math.max(limit * 4, 200));
    const unique = new Map();
    for (const video of [...direct, ...memoVideos, ...fallbackVideos]) {
      if (!video || video.isShort || shortIds.has(video.id) || unique.has(video.id)) continue;
      unique.set(video.id, video);
      if (unique.size >= limit) break;
    }
    return [...unique.values()];
  }

  function homeShorts(feed, limit) {
    const shelves = homeMemos(feed).flatMap(memo => memoItems({ memo }, YTNodes?.ReelShelf));
    const source = shelves.length ? shelves : [homeMemos(feed), feed];
    const unique = new Map();
    for (const video of collectShorts(source, Math.max(limit * 3, 120))) {
      if (video?.id && !unique.has(video.id)) unique.set(video.id, video);
      if (unique.size >= limit) break;
    }
    return [...unique.values()];
  }

  async function enrichAuthorThumbnails(client, videos) {
    const lookupClient = await youtubePromise;
    // Author metadata is supplementary. Fetch it in small parallel batches so
    // the recommendation request is not serialized behind an artificial delay.
    const targets = videos.filter(video => video && video.id &&
      (!video.duration || !video.authorThumbnail || !video.authorId || !video.author || video.author === 'YouTube')).slice(0, 32);
    const infoCache = new Map();
    for (let offset = 0; offset < targets.length; offset += 8) {
      await Promise.all(targets.slice(offset, offset + 8).map(async video => {
        try {
          const info = await cached(`home-author-info-v3:${video.id}`, 900000, () => lookupClient.getBasicInfo(video.id));
          const b = info?.basic_info || info?.basicInfo || {};
          const durationSeconds = Number(b.duration ?? b.duration_seconds ?? b.durationSeconds);
          if (!video.duration && Number.isFinite(durationSeconds) && durationSeconds > 0) {
            const totalSeconds = Math.floor(durationSeconds);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = String(totalSeconds % 60).padStart(2, '0');
            video.duration = hours
              ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
              : `${minutes}:${seconds}`;
          }
          const channel = b.channel || {};
          const channelId = b.channel_id || b.channelId || channel.id || video.authorId || '';
          const channelName = text(b.author || b.channel_name || b.channelName || channel.name, '');
          const owner = info?.secondary_info?.owner?.author || info?.secondary_info?.owner || {};
          const avatar = proxied(
            bestThumbnail(channel?.thumbnail)?.url ||
            bestThumbnail(channel?.thumbnails)?.url ||
            owner?.best_thumbnail?.url ||
            bestThumbnail(owner?.thumbnails)?.url ||
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
        const avatarUrl = bestThumbnail(avatarSources)?.url || bestThumbnail(meta.avatar)?.url || rawImage(meta) || rawImage(header) || rawImage(channel);
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
    const direct = homeVideos(feed, Math.max(limit * 2, 80));
    let explicitShorts = homeShorts(feed, 32);
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
  
  async function getSignedInHomeVideos(req, limit = 50, excludedIds = []) {
    const client = await accountClient(req);
    if (!client.session.logged_in) return { videos: [], shorts: [], hasMore: false };
    const excluded = new Set(excludedIds);
    const seenVideos = new Set(excluded);
    const seenShorts = new Set(excluded);
    let feed = await client.getHomeFeed();
    const videos = [];
    const shorts = [];
    for (let page = 0; feed && page < 12 && videos.length < limit; page++) {
      for (const video of homeVideos(feed, 100)) {
        if (seenVideos.has(video.id)) continue;
        seenVideos.add(video.id);
        videos.push(video);
        if (videos.length >= limit) break;
      }
      for (const video of homeShorts(feed, 40)) {
        if (seenShorts.has(video.id)) continue;
        seenShorts.add(video.id);
        shorts.push(video);
      }
      if (videos.length >= limit || !feed.has_continuation || typeof feed.getContinuation !== 'function') break;
      try {
        feed = await feed.getContinuation();
      } catch (error) {
        console.warn('Authenticated home continuation:', error?.message || error);
        break;
      }
    }
    const all = [...videos, ...shorts];
    const unique = new Map();
    for (const item of all) if (item?.id && !unique.has(item.id)) unique.set(item.id, item);
    const outputVideos = [...unique.values()].filter(item => !item.isShort).slice(0, limit);
    const outputShorts = [...unique.values()].filter(item => item.isShort).slice(0, 16);
    await enrichAuthorThumbnails(client, [...outputVideos, ...outputShorts]);
    return { videos: outputVideos, shorts: outputShorts, hasMore: Boolean(feed?.has_continuation) };
  }

  async function getLocalRecommendations(body = {}, excludedIds = []) {
    const searches = (Array.isArray(body.searches) ? body.searches : []).map(String).filter(Boolean).slice(0, 8);
    const subscriptions = (Array.isArray(body.subscriptions) ? body.subscriptions : []).filter(channel => channel?.id).slice(0, 10);
    const watched = (Array.isArray(body.watched) ? body.watched : [])
      .filter(entry => entry && /^[\w-]{11}$/.test(String(entry.id)))
      .sort((a, b) => Number(b.seconds || 0) - Number(a.seconds || 0))
      .slice(0, 8);
    const excluded = new Set(excludedIds);
    const pool = new Map();
    const add = (items, base, reason) => items.forEach((item, index) => {
      if (!item || excluded.has(item.id)) return;
      const current = pool.get(item.id) || { ...item, score: 0, reasons: [] };
      current.score += Math.max(1, base - index * 0.35);
      if (!current.reasons.includes(reason)) current.reasons.push(reason);
      pool.set(item.id, current);
    });

    const yt = await youtubePromise;
    await Promise.all(searches.slice(0, 5).map(async (term, index) => {
      try {
        const result = await cached(`recommend:search:${term}`, 300000, () => yt.search(term, { type: 'video' }));
        add(collectVideos(result, 18), 22 - index * 1.5, '検索履歴');
      } catch (error) {
        console.warn(`Recommendation search unavailable for "${term}":`, error?.message || error);
      }
    }));
    await Promise.all(subscriptions.slice(0, 6).map(async (channel, index) => {
      try {
        const feed = await cached(`recommend:channel:${channel.id}`, 300000, async () => {
          const result = await yt.getChannel(channel.id);
          return result.has_videos ? result.getVideos() : result;
        });
        add(collectVideos(feed, 20), 29 - index, '登録チャンネル');
      } catch (error) {
        console.warn(`Recommendation channel unavailable for "${channel.id}":`, error?.message || error);
      }
    }));
    await Promise.all(watched.slice(0, 5).map(async (entry, index) => {
      try {
        const info = await cached(`info:${entry.id}`, 900000, () => yt.getInfo(entry.id));
        add(Array.from(info.watch_next_feed || []).map(normalizeVideo).filter(Boolean), 34 + Math.min(16, Number(entry.seconds || 0) / 60) - index, '長時間視聴');
      } catch (error) {
        console.warn(`Recommendation watch history unavailable for "${entry.id}":`, error?.message || error);
      }
    }));
    if (pool.size < 40 || excluded.size) {
      try {
        let feed = await cached('home', 120000, () => yt.getHomeFeed());
        for (let page = 0; feed && page < 12 && pool.size < 60; page++) {
          add(homeVideos(feed, 100), 9, 'ホーム');
          add(homeShorts(feed, 40), 9, 'Shorts');
          if (!feed.has_continuation || typeof feed.getContinuation !== 'function') break;
          feed = await feed.getContinuation();
        }
      } catch (error) {
        console.warn('Home feed unavailable:', error?.message || error);
      }
    }
    if (pool.size < 24) {
      const fallbackTerms = ['人気 動画', 'ゲーム 実況', 'スポーツ', '料理', 'テクノロジー'];
      await Promise.all(fallbackTerms.map(async (term, index) => {
        try {
          const result = await cached(`recommend:fallback:v1:${term}`, 300000, () => yt.search(term, { type: 'video' }));
          add(collectVideos(result, 40), 8 - index * 0.25, 'おすすめ');
        } catch (error) {
          console.warn(`Recommendation fallback unavailable for "${term}":`, error?.message || error);
        }
      }));
    }

    const ranked = [...pool.values()].sort((a, b) => b.score - a.score).map(({ score, reasons, ...video }) => ({ ...video, reasons }));
    const videos = ranked.filter(video => !video.isShort).slice(0, 40);
    const shorts = ranked.filter(video => video.isShort).slice(0, 16);
    await enrichAuthorThumbnails(yt, [...videos, ...shorts]);
    return { videos, shorts, hasMore: videos.length > 0, source: 'local', authenticated: false };
  }

  return { enrichAuthorThumbnails, buildHomeRecommendations, getSignedInHomeVideos, getLocalRecommendations };
}
