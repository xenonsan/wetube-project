import { Innertube, UniversalCache } from 'youtubei.js';

const IMAGE_HOSTS = new Set(['i.ytimg.com', 'yt3.ggpht.com', 'yt3.googleusercontent.com']);
const isImageHost = hostname => IMAGE_HOSTS.has(hostname) || hostname.endsWith('.ytimg.com') || hostname.endsWith('.ggpht.com') || hostname.endsWith('.googleusercontent.com');

const youtubePromise = Innertube.create({ cache: new UniversalCache(true), retrieve_player: false, generate_session_locally: true, lang: 'ja', location: 'JP' });
const text = (value, fallback = '') => {
  if (value == null) return fallback;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const rendered = value?.toString?.();
  return rendered && rendered !== '[object Object]' ? rendered : value.text || value.simple_text || value.runs?.map(x => x.text).join('') || fallback;
};
const rawImage = item => {
  const candidates = [
    item?.thumbnails, item?.thumbnail?.thumbnails, item?.author?.thumbnails, item?.avatar?.thumbnails,
    item?.account_photo, item?.image, item?.image?.sources, item?.image?.thumbnails,
    item?.header?.tile_header_renderer?.thumbnail, item?.header?.tileHeaderRenderer?.thumbnail,
    item?.content_image?.image, item?.content_image?.primary_thumbnail?.image,
    item?.metadata?.image?.avatar?.image, item?.avatar?.image, item?.image?.avatar?.image,
    item?.metadata?.lockup_metadata_view_model?.image?.avatar?.image,
    item?.metadata?.lockupMetadataViewModel?.image?.avatar?.image,
    item?.content_image?.collection_thumbnail_view_model?.primary_thumbnail?.thumbnail_view_model?.image?.sources,
    item?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources
  ];
  const flat = [];
  const walk = value => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value === 'object') {
      if (typeof value.url === 'string') flat.push(value);
      if (Array.isArray(value.sources)) value.sources.forEach(walk);
      if (Array.isArray(value.thumbnails)) value.thumbnails.forEach(walk);
      return;
    }
    if (typeof value === 'string' && /^https?:\/\//.test(value)) flat.push({ url: value });
  };
  candidates.forEach(walk);
  return flat.at(-1)?.url || '';
};
const proxied = url => {
  try {
    let value = String(url || '').trim();
    if (value.startsWith('//')) value = `https:${value}`;
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && isImageHost(parsed.hostname) ? `/image-proxy?url=${encodeURIComponent(parsed.href)}` : '';
  } catch { return ''; }
};
const videoThumbnail = (item, id) => {
  const candidates = [
    item?.thumbnails,
    item?.thumbnail?.thumbnails,
    item?.rich_thumbnail?.thumbnails,
    item?.content_image?.primary_thumbnail?.image,
    item?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources,
    item?.on_tap_endpoint?.payload?.thumbnail?.thumbnails,
    item?.onTapEndpoint?.payload?.thumbnail?.thumbnails
  ];
  for (const list of candidates) {
    if (Array.isArray(list) && list.length) {
      const url = list.at(-1)?.url || '';
      if (url) return proxied(url);
    }
  }
  return proxied(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
};
const shortSessions = new Map();
const shortSessionTtl = 30 * 60 * 1000;
const shortText = value => text(value?.content || value?.text || value?.simple_text || value?.simpleText || value, '');
const normalizeShort = item => {
  const endpoint = item?.on_tap_endpoint || item?.onTapEndpoint || item?.endpoint || item?.navigation_endpoint || {};
  const payload = endpoint?.payload || endpoint?.reelWatchEndpoint || endpoint?.watchEndpoint || {};
  const id = payload?.videoId || payload?.video_id || item?.video_id || item?.content_id || item?.contentId;
  if (!id || !/^[\w-]{11}$/.test(String(id))) return null;
  const overlay = item?.overlay_metadata || item?.overlayMetadata || {};
  const primary = shortText(overlay.primary_text || overlay.primaryText || overlay.title);
  const secondary = shortText(overlay.secondary_text || overlay.secondaryText);
  const accessibility = text(item?.accessibility_text, '');
  const accessibilityParts = accessibility.split(',');
  const fallbackTitle = String(accessibilityParts[0] || '').trim();
  const title = primary || text(item?.title || item?.headline, '') || fallbackTitle || 'ショート';
  const views = secondary || String(accessibilityParts[1] || '').split('-')[0].trim();
  const thumbs = payload?.thumbnail?.thumbnails || item?.thumbnail?.thumbnails || item?.thumbnail?.thumbnail_view_model?.image?.sources || item?.thumbnail?.thumbnailViewModel?.image?.sources || [];
  const thumb = Array.isArray(thumbs) ? thumbs.at(-1)?.url : '';
  const author = text(item?.author?.name || item?.owner_text || item?.short_byline_text || item?.long_byline_text, 'YouTube');
  const authorId = item?.author?.id || item?.author?.channel_id || item?.owner_text?.runs?.[0]?.navigation_endpoint?.browseEndpoint?.browseId || '';
  return { id:String(id), title, isShort:true, author, authorId, authorThumbnail:proxied(rawImage(item?.author)), thumbnail:proxied(thumb) || proxied(`https://i.ytimg.com/vi/${id}/frame0.jpg`), duration:'', views, published:text(item?.published_time_text || item?.published_time, ''), description:'' };
};
function collectShorts(source, limit = 80) {
  const output = [], ids = new Set(), seen = new WeakSet();
  function walk(node, depth = 0) {
    if (!node || depth > 18 || output.length >= limit) return;
    if (Array.isArray(node)) return node.forEach(value => walk(value, depth + 1));
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const type = String(node.type || node.constructor?.type || node.constructor?.name || '');
    const endpoint = node.on_tap_endpoint || node.onTapEndpoint || node.endpoint || node.navigation_endpoint || {};
    const endpointName = String(endpoint.name || endpoint.type || '');
    const isShortNode = /ShortsLockupView|ReelItem|shortsLockupViewModel/i.test(type) || /reelWatchEndpoint/i.test(endpointName) || node.content_type === 'SHORT';
    if (isShortNode) {
      const item = normalizeShort(node);
      if (item && !ids.has(item.id)) { ids.add(item.id); output.push(item); }
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  }
  walk(source); return output;
}
const normalizeVideo = item => {
  // Search now frequently returns Tile nodes. Their video id is content_id and
  // title is nested below metadata/header instead of the legacy video fields.
  const endpoint = item?.endpoint || item?.navigation_endpoint || item?.on_select_command || item?.onSelectCommand;
  const id = item?.video_id || item?.content_id || item?.contentId || item?.id || endpoint?.payload?.videoId || endpoint?.payload?.video_id;
  if (!id || !/^[\w-]{11}$/.test(String(id))) return null;
  const author = item.author || item.owner || {};
  const lockupModel = item.metadata?.lockup_metadata_view_model || item.metadata?.lockupMetadataViewModel || item.lockup_metadata_view_model || item.lockupMetadataViewModel || {};
  const contentMetadata = lockupModel.metadata?.content_metadata_view_model || lockupModel.metadata?.contentMetadataViewModel || item.metadata?.content_metadata_view_model || item.metadata?.contentMetadataViewModel || {};
  const lockupRows = item.metadata?.metadata?.metadata_rows || item.metadata?.metadata_rows || contentMetadata.metadata_rows || contentMetadata.metadataRows || [];
  const lockupText = lockupRows.flatMap(row => row?.metadata_parts || row?.metadataParts || []).map(part => text(part?.text || part?.text?.content || part)).filter(Boolean);
  const legacyLines = Array.isArray(item.metadata?.lines) ? item.metadata.lines.map(line => text(line?.text || line)).filter(Boolean) : [];
  const lineText = [...lockupText, ...legacyLines];
  const title = text(item.title || item.metadata?.title || lockupModel.title?.content || lockupModel.title || item.header?.title || item.primary_text, 'タイトル不明');
  const nodeType = String(item?.type || item?.constructor?.type || item?.constructor?.name || '');
  const isShort = item?.content_type === 'SHORT' || /ReelItem|ShortsLockup/i.test(nodeType) || Boolean(endpoint?.payload?.reelWatchEndpoint || item?.reel_watch_endpoint);
  const ownerRun = item.owner_text?.runs?.[0] || item.short_byline_text?.runs?.[0] || item.long_byline_text?.runs?.[0] || {};
  const ownerEndpoint = ownerRun.navigation_endpoint || ownerRun.navigationEndpoint || {};
  const lockupAvatar = rawImage(item.metadata?.image) || rawImage(item.metadata?.image?.avatar) || rawImage(lockupModel.image) || rawImage(item);
  const rawAuthorName = text(author.name || author || item.owner_text || item.short_byline_text || item.long_byline_text || ownerRun.text || lockupText.find(value => !/回視聴|views?|前|ago|公開|配信/i.test(value)), 'YouTube');
  const authorName = /YouTube\\s*(アカウントからおすすめ|account recommendations?|recommended)/i.test(rawAuthorName) ? 'YouTube' : rawAuthorName;
  const authorId = author.id || author.channel_id || ownerEndpoint?.payload?.browseId || ownerEndpoint?.browseEndpoint?.browseId || endpoint?.payload?.browseId || item?.metadata?.image?.renderer_context?.command_context?.on_tap?.payload?.browseId || lockupModel?.image?.decorated_avatar_view_model?.renderer_context?.command_context?.on_tap?.innertube_command?.browseEndpoint?.browseId || '';
  const viewText = lineText.find(value => /回視聴|視聴回数|views?/i.test(value)) || lineText[1] || '';
  const publishedText = lineText.find(value => /前| ago|配信|公開|premiered|streamed/i.test(value)) || lineText[2] || '';
  return {
    id: String(id), title, isShort, author: authorName,
    authorId, authorThumbnail: proxied(rawImage(author) || lockupAvatar),
    thumbnail: videoThumbnail(item, id),
    duration: text(item.duration?.text || item.length_text || item.duration, ''),
    views: text(item.short_view_count || item.view_count || viewText, ''), published: text(item.published || publishedText, ''), description: text(item.description_snippet || item.description, '')
  };
};
function collectVideos(source, limit = 80) {
  const out = [], ids = new Set(), seen = new WeakSet();
  function walk(node, depth = 0) {
    if (!node || depth > 14 || out.length >= limit) return;
    if (Array.isArray(node)) return node.forEach(value => walk(value, depth + 1));
    if (node instanceof Map) { for (const value of node.values()) walk(value, depth + 1); return; }
    if (node instanceof Set) { for (const value of node.values()) walk(value, depth + 1); return; }
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const item = normalizeVideo(node);
    if (item && !ids.has(item.id)) { ids.add(item.id); out.push(item); }
    // YouTube.js feed structures differ by tab and parser version. Traverse all
    // enumerable renderer properties instead of assuming a small key list.
    for (const value of Object.values(node)) walk(value, depth + 1);
  }
  walk(source); return out;
}

function collectPlaylists(source, limit = 60) {
  const out = [], ids = new Set(), seen = new WeakSet();
  function walk(node, depth = 0) {
    if (!node || depth > 14 || out.length >= limit) return;
    if (Array.isArray(node)) return node.forEach(value => walk(value, depth + 1));
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const type = String(node.type || node.constructor?.type || node.constructor?.name || '');
    const id = node.playlist_id || node.playlistId || node.content_id || node.contentId || node.endpoint?.payload?.playlistId || node.navigation_endpoint?.payload?.playlistId || node.renderer_context?.command_context?.on_tap?.innertube_command?.browseEndpoint?.browseId;
    const title = text(node.title || node.metadata?.title, '');
    if (id && title && !ids.has(id)) {
      ids.add(id);
      out.push({ id, title, author: text(node.author?.name || node.author, ''), thumbnail: proxied(rawImage(node)) || videoThumbnail(node, ''), count: text(node.video_count || node.video_count_text || node.item_count || node.metadata?.metadata?.metadata_rows?.flatMap(r=>r.metadata_parts||[]).map(p=>text(p.text||p)).find(v=>/本の動画|videos/i.test(v)), ''), isPlaylist: true, nodeType: type });
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  }
  walk(source); return out;
}

function collectChannels(source, limit = 40) {
  const out = [], ids = new Set(), seen = new WeakSet();
  function walk(node, depth = 0) {
    if (!node || depth > 14 || out.length >= limit) return;
    if (Array.isArray(node)) return node.forEach(value => walk(value, depth + 1));
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const type = String(node.type || node.constructor?.type || node.constructor?.name || '');
    const author = node.author || {};
    const id = node.channel_id || node.channelId || node.content_id || node.contentId || node.id || node.endpoint?.payload?.browseId || node.navigation_endpoint?.payload?.browseId;
    const isChannel = /channel/i.test(type) || /CHANNEL/i.test(String(node.content_type || node.contentType || '')) || (String(id || '').startsWith('UC') && Boolean(node.subscriber_count || node.video_count || node.description_snippet));
    if (isChannel && id && !ids.has(id)) {
      const tileMeta = node.metadata?.tile_metadata_renderer || node.metadata?.tileMetadataRenderer || {};
      const tileHeader = node.header?.tile_header_renderer || node.header?.tileHeaderRenderer || {};
      const name = text(author.name || node.title || node.name || tileMeta.title || node.short_byline || node.long_byline, 'チャンネル');
      ids.add(id);
      out.push({ id, name, handle: text(author.handle || node.handle || node.channel_handle, ''), subscribers: text(node.subscriber_count || node.subscribers, ''), videos: text(node.video_count || node.video_count_text, ''), description: text(node.description_snippet || node.description, ''), thumbnail: proxied(rawImage(author) || rawImage(node)) });
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  }
  walk(source); return out;
}
function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}


function numericViews(value) {
  const source = String(value || '').replace(/,/g, '');
  const number = Number((source.match(/[\d.]+/) || ['0'])[0]);
  const multiplier = /億/.test(source) ? 1e8 : /万/.test(source) ? 1e4 : /K/i.test(source) ? 1e3 : /M/i.test(source) ? 1e6 : /B/i.test(source) ? 1e9 : 1;
  return number * multiplier;
}

function normalizeFeedVideos(feed, limit = 50) {
  // HomeFeed exposes a documented `videos` accessor. Prefer it over walking
  // private parser internals, then keep the recursive collector as fallback.
  const direct = Array.from(feed?.videos || []).map(normalizeVideo).filter(Boolean);
  // Memo extends Map in YouTube.js. Object.values() cannot see Map entries, so
  // explicitly scan all response memos before falling back to the feed object.
  const memoSources = [feed?.memo, feed?.page?.contents_memo, feed?.page?.header_memo, feed?.page?.on_response_received_actions_memo, feed?.page?.on_response_received_endpoints_memo].filter(Boolean);
  const memoVideos = direct.length ? [] : collectVideos(memoSources, limit);
  const fallback = direct.length || memoVideos.length ? [] : collectVideos(feed, limit);
  const output = [], ids = new Set();
  for (const video of [...direct, ...memoVideos, ...fallback]) {
    if (!video || ids.has(video.id)) continue;
    ids.add(video.id); output.push(video);
    if (output.length >= limit) break;
  }
  return output;
}

export {
  isImageHost,
  youtubePromise,
  text,
  rawImage,
  proxied,
  videoThumbnail,
  normalizeShort,
  collectShorts,
  normalizeVideo,
  collectVideos,
  collectPlaylists,
  collectChannels,
  shuffled,
  numericViews,
  normalizeFeedVideos
};

