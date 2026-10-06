export function createShortsService({ youtubePromise, eduParams, walkRaw, text, proxied, bestThumbnail }) {
  const shortSessions = new Map();
  const shortSessionTtl = 30 * 60 * 1000;

  
  function makeShortSession(feed, { channelId = '', channelTitle = '', seen = [], mode = 'feed', seedId = '', seedIds = [] } = {}) {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    shortSessions.set(token, { feed, channelId, channelTitle, seen: new Set(seen), mode, seedId, seedIds: [...new Set(seedIds)], seedCursor: 0, expires: Date.now() + shortSessionTtl });
    return token;
  }
  function shortInfoToVideo(info) {
    const b = info?.basic_info || {};
    const thumb = bestThumbnail(b.thumbnail)?.url || '';
    return { id:String(b.id || ''), title:text(b.title, 'ショート'), isShort:true, author:text(b.author || b.channel?.name, 'YouTube'), authorId:String(b.channel_id || b.channel?.id || ''), authorThumbnail:'', thumbnail:proxied(thumb) || proxied(`https://i.ytimg.com/vi/${b.id}/frame0.jpg`), duration:b.duration ? `${b.duration}s` : '', views:b.view_count ? Number(b.view_count).toLocaleString('ja-JP') + ' 回視聴' : '', published:'', description:text(b.short_description, '') };
  }
  function spreadSeeds(ids, count = 4) {
    if (ids.length <= count) return ids;
    const selected = new Set();
    for (let index = 0; index < count; index++) selected.add(ids[Math.floor(index * (ids.length - 1) / (count - 1))]);
    return [...selected];
  }
  function interleave(sequences) {
    const output = [];
    for (let index = 0; sequences.some(sequence => index < sequence.length); index++) {
      for (const sequence of sequences) if (sequence[index]) output.push(sequence[index]);
    }
    return output;
  }
  function diversifyShorts(videos, limit) {
    const buckets = new Map();
    for (const video of videos) {
      const author = video.authorId || (/^(?:|youtube|チャンネル)$/i.test(video.author) ? video.id : video.author.toLocaleLowerCase());
      const bucket = buckets.get(author) || [];
      bucket.push(video);
      buckets.set(author, bucket);
    }
    const output = [];
    while (output.length < limit) {
      let added = false;
      for (const bucket of buckets.values()) {
        const next = bucket.shift();
        if (!next) continue;
        output.push(next);
        added = true;
        if (output.length >= limit) break;
      }
      if (!added) break;
    }
    return output;
  }
  async function collectSeedSequenceIds(yt, seeds) {
    const infos = await Promise.all(seeds.map(id => yt.getShortsVideoInfo(id).catch(() => null)));
    return interleave(infos.map((info, index) => [
      seeds[index],
      ...Array.from(info?.watch_next_feed || [])
        .map(endpoint => endpoint?.payload?.videoId)
        .filter(id => /^[\w-]{11}$/.test(String(id || '')))
    ]));
  }
  async function loadShortMetadata(yt, ids, limit) {
    const unique = [...new Set(ids)].slice(0, limit);
    const infos = await Promise.all(unique.map(id => yt.getBasicInfo(id).catch(() => null)));
    return diversifyShorts(
      infos.map(shortInfoToVideo).filter(video => /^[\w-]{11}$/.test(video.id)),
      limit
    );
  }
  async function discoverSeedlessShorts(yt, limit = 24) {
    const endpoint = await yt.resolveURL('https://www.youtube.com/shorts');
    const response = await endpoint.call(yt.session.actions);
    const root = response?.data || response;
    const ids = new Set();
    walkRaw(root, node => {
      const id = node?.reelWatchEndpoint?.videoId || node?.reel_watch_endpoint?.videoId || node?.videoId;
      if (/^[\w-]{11}$/.test(String(id || ''))) ids.add(String(id));
    }, 24);
    const pageIds = [...ids];
    if (!pageIds.length) return { videos: [], seedId: '', seedIds: [] };
    const anchors = spreadSeeds(pageIds);
    const recommendationIds = await collectSeedSequenceIds(yt, anchors);
    const videos = await loadShortMetadata(yt, recommendationIds, limit);
    const seedId = videos.at(-1)?.id || anchors.at(-1) || '';
    const anchorIds = new Set(anchors);
    return { videos, seedId, seedIds: pageIds.filter(id => !anchorIds.has(id)) };
  }
  async function nextSeededShorts(yt, session, limit = 24) {
    const candidateIds = [];
    let attempts = 0;
    while (candidateIds.length < limit && session.seedCursor < session.seedIds.length && attempts < 4) {
      const seeds = session.seedIds.slice(session.seedCursor, session.seedCursor + 3);
      session.seedCursor += seeds.length;
      attempts++;
      const sequenceIds = await collectSeedSequenceIds(yt, seeds);
      for (const id of sequenceIds) {
        if (!session.seen.has(id) && !candidateIds.includes(id)) candidateIds.push(id);
      }
    }
    const videos = await loadShortMetadata(yt, candidateIds, limit);
    for (const video of videos) session.seen.add(video.id);
    if (videos.length) session.seedId = videos.at(-1).id;
    return { videos, hasMore: session.seedCursor < session.seedIds.length };
  }
  function getShortSession(token) {
    const session = shortSessions.get(String(token || ''));
    if (!session || session.expires < Date.now()) { if (token) shortSessions.delete(String(token)); return null; }
    session.expires = Date.now() + shortSessionTtl;
    return session;
  }
  function shortEmbedUrl(videoId, params) {
    const url = new URL(`https://www.youtubeeducation.com/embed/${videoId}${params}`);
    url.searchParams.set('loop', '1');
    url.searchParams.set('playlist', String(videoId));
    return url.href;
  }
  function prepareShorts(items, params, session) {
    return items.filter(Boolean).map(video => ({
      ...video,
      isShort: true,
      author: session?.channelTitle || video.author || 'YouTube',
      authorId: session?.channelId || video.authorId || '',
      eduUrl: shortEmbedUrl(video.id, params)
    }));
  }

  return { makeShortSession, shortInfoToVideo, discoverSeedlessShorts, nextSeededShorts, getShortSession, prepareShorts };
}
