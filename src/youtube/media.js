import { Innertube, UniversalCache } from 'youtubei.js';

const IMAGE_HOSTS = new Set(['i.ytimg.com', 'yt3.ggpht.com', 'yt3.googleusercontent.com']);
const isImageHost = hostname => IMAGE_HOSTS.has(hostname) || hostname.endsWith('.ytimg.com') || hostname.endsWith('.ggpht.com') || hostname.endsWith('.googleusercontent.com');

const youtubePromise = Innertube.create({ cache: new UniversalCache(true), retrieve_player: false, generate_session_locally: true, lang: 'ja', location: 'JP' });
const text = (value, fallback = '') => {
  if (value == null) return fallback;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(item => text(item, '')).join('') || fallback;
  if (typeof value?.simpleText === 'string') return value.simpleText;
  if (typeof value?.simple_text === 'string') return value.simple_text;
  if (typeof value?.text === 'string') return value.text;
  if (value?.text && typeof value.text === 'object') return text(value.text, fallback);
  if (Array.isArray(value?.runs)) return value.runs.map(run => text(run?.text, '')).join('') || fallback;
  if (typeof value?.content === 'string') return value.content;
  if (value?.content && typeof value.content === 'object') return text(value.content, fallback);
  const rendered = value?.toString?.();
  return rendered && rendered !== '[object Object]' ? rendered : fallback;
};
const formatViewCount = value => {
  const valueText = text(value, '').trim();
  if (!valueText || /回視聴|視聴回数|views?/i.test(valueText)) return valueText;
  const match = valueText.match(/^([\d,]+(?:\.\d+)?)\s*([万億]?)(?:\s*回)?$/u);
  if (!match) return valueText;
  const count = Number(match[1].replaceAll(',', ''));
  if (!Number.isFinite(count)) return valueText;
  const formatted = match[2] ? `${match[1]}${match[2]}` : count.toLocaleString('ja-JP');
  return `${formatted} 回視聴`;
};
const bestThumbnail = thumbnails => {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return null;
  return [...thumbnails].sort((a, b) => {
    const area = item => Number(item?.width || 0) * Number(item?.height || 0);
    return area(b) - area(a);
  })[0];
};
const rawImage = item => {
  const candidates = [
    item?.thumbnails, item?.thumbnail?.thumbnails, item?.author?.thumbnails, item?.avatar?.thumbnails,
    item?.avatar_thumbnail_url, item?.author?.avatar_thumbnail_url,
    item?.account_photo, item?.image, item?.image?.sources, item?.image?.thumbnails,
    item?.thumbnailViewModel?.image, item?.thumbnail_view_model?.image,
    item?.content_image?.primary_thumbnail?.image, item?.content_image?.primary_thumbnail?.thumbnail_view_model?.image,
    item?.contentImage?.primaryThumbnail?.thumbnailViewModel?.image,
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
  return bestThumbnail(flat)?.url || '';
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
    item?.thumbnail_view_model?.image?.sources,
    item?.thumbnailViewModel?.image?.sources,
    item?.thumbnail,
    item?.rich_thumbnail?.thumbnails,
    item?.content_image?.image,
    item?.content_image?.primary_thumbnail?.image,
    item?.content_image?.primary_thumbnail?.thumbnail_view_model?.image?.sources,
    item?.contentImage?.image,
    item?.contentImage?.thumbnailViewModel?.image?.sources,
    item?.contentImage?.primaryThumbnail?.thumbnailViewModel?.image?.sources,
    item?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources,
    item?.on_tap_endpoint?.payload?.thumbnail?.thumbnails,
    item?.onTapEndpoint?.payload?.thumbnail?.thumbnails
  ];
  for (const list of candidates) {
    if (Array.isArray(list) && list.length) {
      const url = bestThumbnail(list)?.url || '';
      if (url) return proxied(url);
    }
  }
  return proxied(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
};
const shortSessions = new Map();
const shortSessionTtl = 30 * 60 * 1000;
const shortText = value => text(value?.content || value?.text || value?.simple_text || value?.simpleText || value, '');
const validAuthorName = value => {
  const name = text(value, '').trim();
  return name && !/^(?:N\/A|YouTube|チャンネル|動画)$/i.test(name) ? name : '';
};
const authorNameFrom = item => {
  const author = item?.author || item?.owner;
  const byline = item?.owner_text || item?.short_byline_text || item?.long_byline_text || item?.byline;
  const lockupModel = item?.metadata?.lockup_metadata_view_model || item?.metadata?.lockupMetadataViewModel || item?.lockup_metadata_view_model || item?.lockupMetadataViewModel || {};
  const rows = item?.metadata?.metadata?.metadata_rows || item?.metadata?.metadata_rows ||
    item?.metadata?.metadataRows || lockupModel.metadata?.content_metadata_view_model?.metadata_rows ||
    lockupModel.metadata?.contentMetadataViewModel?.metadataRows || [];
  const metadataNames = rows.flatMap(row => row?.metadata_parts || row?.metadataParts || [])
    .map(part => text(part?.text ?? part, '').trim())
    .filter(value => value && !/^@/.test(value) && !/回視聴|視聴回数|views?|登録者|subscribers?|本の動画|videos?|前| ago|公開|配信/i.test(value));
  for (const candidate of [author?.name, author, item?.channel_name, item?.channelName, byline, metadataNames[0]]) {
    const name = validAuthorName(candidate);
    if (name) return name;
  }
  return '';
};
const channelIdFrom = item => {
  const author = item?.author || item?.owner;
  const run = item?.owner_text?.runs?.[0] || item?.short_byline_text?.runs?.[0] || item?.long_byline_text?.runs?.[0] || {};
  const endpoint = run.navigation_endpoint || run.navigationEndpoint || {};
  const imageEndpoint = item?.metadata?.image?.renderer_context?.command_context?.on_tap?.innertube_command?.browseEndpoint ||
    item?.metadata?.image?.decorated_avatar_view_model?.renderer_context?.command_context?.on_tap?.innertube_command?.browseEndpoint;
  const id = author?.id || author?.channel_id || item?.channel_id || item?.channelId ||
    endpoint?.payload?.browseId || endpoint?.browseEndpoint?.browseId || imageEndpoint?.browseId ||
    item?.navigation_endpoint?.payload?.browseId || item?.navigationEndpoint?.browseEndpoint?.browseId;
  return /^UC[\w-]{20,}$/.test(String(id || '')) ? String(id) : '';
};
const normalizeShort = item => {
  const endpoint = item?.on_tap_endpoint || item?.onTapEndpoint || item?.endpoint || item?.navigation_endpoint || {};
  const payload = endpoint?.payload || endpoint?.reelWatchEndpoint || endpoint?.watchEndpoint || {};
  const id = payload?.videoId || payload?.video_id || item?.video_id || item?.content_id || item?.contentId || item?.id;
  if (!id || !/^[\w-]{11}$/.test(String(id))) return null;
  const overlay = item?.overlay_metadata || item?.overlayMetadata || {};
  const primary = shortText(overlay.primary_text || overlay.primaryText || overlay.title);
  const secondary = shortText(overlay.secondary_text || overlay.secondaryText);
  const accessibility = text(item?.accessibility_text, '');
  const accessibilityParts = accessibility.split(',');
  const fallbackTitle = String(accessibilityParts[0] || '').trim();
  const title = primary || text(item?.title || item?.headline, '') || fallbackTitle || 'ショート';
  const views = secondary || String(accessibilityParts[1] || '').split('-')[0].trim();
  const thumbnails = [
    ...(Array.isArray(item?.thumbnails) ? item.thumbnails : []),
    ...(Array.isArray(payload?.thumbnail?.thumbnails) ? payload.thumbnail.thumbnails : []),
    ...(Array.isArray(item?.thumbnail) ? item.thumbnail : []),
    ...(Array.isArray(item?.thumbnail?.thumbnails) ? item.thumbnail.thumbnails : []),
    ...(Array.isArray(item?.thumbnail?.thumbnail_view_model?.image?.sources) ? item.thumbnail.thumbnail_view_model.image.sources : []),
    ...(Array.isArray(item?.thumbnail?.thumbnailViewModel?.image?.sources) ? item.thumbnail.thumbnailViewModel.image.sources : []),
    ...(Array.isArray(item?.thumbnail_view_model?.image?.sources) ? item.thumbnail_view_model.image.sources : []),
    ...(Array.isArray(item?.thumbnailViewModel?.image?.sources) ? item.thumbnailViewModel.image.sources : [])
  ];
  const thumb = bestThumbnail(thumbnails)?.url || '';
  const author = authorNameFrom(item) || 'YouTube';
  const authorId = channelIdFrom(item);
  return { id:String(id), title, isShort:true, author, authorId, authorThumbnail:proxied(rawImage(item?.author)), thumbnail:proxied(thumb) || proxied(`https://i.ytimg.com/vi/${id}/frame0.jpg`), duration:'', views:formatViewCount(views), published:text(item?.published_time_text || item?.published_time, ''), description:'' };
};
function collectShorts(source, limit = 80) {
  const output = [], ids = new Set(), seen = new WeakSet();
  function walk(node, depth = 0, inShorts = false) {
    if (!node || depth > 18 || output.length >= limit) return;
    if (Array.isArray(node)) return node.forEach(value => walk(value, depth + 1, inShorts));
    if (node instanceof Map) { for (const value of node.values()) walk(value, depth + 1, inShorts); return; }
    if (node instanceof Set) { for (const value of node.values()) walk(value, depth + 1, inShorts); return; }
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const type = String(node.type || node.constructor?.type || node.constructor?.name || '');
    const endpoint = node.on_tap_endpoint || node.onTapEndpoint || node.endpoint || node.navigation_endpoint || {};
    const endpointName = String(endpoint.name || endpoint.type || '');
    const contentType = String(node.content_type || node.contentType || '').replace(/^LOCKUP_CONTENT_TYPE_/, '');
    const isShortNode = inShorts || /ShortsLockupView|ReelItem|shortsLockupViewModel|reelItemRenderer/i.test(type) ||
      /reelWatchEndpoint/i.test(endpointName) || contentType === 'SHORT' ||
      Boolean(node.reelItemRenderer || node.shortsLockupViewModel || node.reel_item_renderer || node.shorts_lockup_view_model);
    if (isShortNode) {
      const item = normalizeShort(node);
      if (item && !ids.has(item.id)) { ids.add(item.id); output.push(item); }
    }
    for (const [key, value] of Object.entries(node)) {
      const childIsShort = isShortNode || /^(?:reelItemRenderer|shortsLockupViewModel|reel_item_renderer|shorts_lockup_view_model)$/i.test(key);
      walk(value, depth + 1, childIsShort);
    }
  }
  walk(source); return output;
}
const normalizeVideo = item => {
  // Search now frequently returns Tile nodes. Their video id is content_id and
  // title is nested below metadata/header instead of the legacy video fields.
  const endpoint = item?.endpoint || item?.navigation_endpoint || item?.navigationEndpoint || item?.on_tap_endpoint || item?.onTapEndpoint || item?.on_select_command || item?.onSelectCommand;
  const payload = endpoint?.payload || endpoint?.reelWatchEndpoint || endpoint?.watchEndpoint || {};
  const rawId = item?.video_id || item?.videoId || item?.content_id || item?.contentId || item?.id || payload.videoId || payload.video_id || endpoint?.reelWatchEndpoint?.videoId || endpoint?.watchEndpoint?.videoId;
  const id = String(rawId || '').replace(/^(?:video|shorts):/, '');
  if (!id || !/^[\w-]{11}$/.test(String(id))) return null;
  const author = item.author || item.owner || {};
  const lockupModel = item.metadata?.lockup_metadata_view_model || item.metadata?.lockupMetadataViewModel || item.lockup_metadata_view_model || item.lockupMetadataViewModel || {};
  const contentMetadata = lockupModel.metadata?.content_metadata_view_model || lockupModel.metadata?.contentMetadataViewModel || item.metadata?.content_metadata_view_model || item.metadata?.contentMetadataViewModel || {};
  const lockupRows = item.metadata?.metadata?.metadata_rows || item.metadata?.metadata_rows || contentMetadata.metadata_rows || contentMetadata.metadataRows || [];
  const lockupText = lockupRows.flatMap(row => row?.metadata_parts || row?.metadataParts || []).map(part => text(part?.text || part?.text?.content || part)).filter(Boolean);
  const legacyLines = Array.isArray(item.metadata?.lines) ? item.metadata.lines.map(line => text(line?.text || line)).filter(Boolean) : [];
  const lineText = [...lockupText, ...legacyLines];
  const nodeType = String(item?.type || item?.constructor?.type || item?.constructor?.name || '');
  const endpointName = String(endpoint?.name || endpoint?.type || '');
  const contentType = String(item?.content_type || item?.contentType || '').replace(/^LOCKUP_CONTENT_TYPE_/, '');
  const isShort = contentType === 'SHORT' ||
    /ReelItem|ShortsLockup/i.test(nodeType) || /reelWatchEndpoint/i.test(endpointName) ||
    Boolean(endpoint?.reelWatchEndpoint || payload.reelWatchEndpoint || item?.reel_watch_endpoint);
  const title = text(
    item.title || item.overlay_metadata?.primary_text || item.overlayMetadata?.primaryText ||
    item.metadata?.title || lockupModel.title?.content || lockupModel.title ||
    item.header?.title || item.primary_text,
    `動画 (${id})`
  );
  const ownerRun = item.owner_text?.runs?.[0] || item.short_byline_text?.runs?.[0] || item.long_byline_text?.runs?.[0] || {};
  const ownerEndpoint = ownerRun.navigation_endpoint || ownerRun.navigationEndpoint || {};
  const lockupAvatar = rawImage(item.metadata?.image) || rawImage(item.metadata?.image?.avatar) ||
    rawImage(item.metadata?.image?.avatar?.image) || rawImage(lockupModel.image) || rawImage(item);
  const rawAuthorName = authorNameFrom(item) || validAuthorName(ownerRun.text) ||
    lockupText.find(value => !/回視聴|views?|前|ago|公開|配信/i.test(value)) || '';
  const authorName = /YouTube\s*(アカウントからおすすめ|account recommendations?|recommended)/i.test(rawAuthorName) ? '' : rawAuthorName;
  const authorId = channelIdFrom(item) || author.id || author.channel_id ||
    ownerEndpoint?.payload?.browseId || ownerEndpoint?.browseEndpoint?.browseId ||
    endpoint?.payload?.browseId || '';
  const viewText = lineText.find(value => /回視聴|視聴回数|views?/i.test(value)) || lineText[1] || '';
  const publishedText = lineText.find(value => /前| ago|配信|公開|premiered|streamed/i.test(value)) || lineText[2] || '';
  return {
    id: String(id), title, isShort, author: authorName,
    authorId, authorThumbnail: proxied(rawImage(author) || lockupAvatar),
    thumbnail: videoThumbnail(item, id),
    duration: text(item.duration?.text || item.length_text || item.duration, ''),
    views: formatViewCount(item.short_view_count || item.view_count || viewText), published: text(item.published || publishedText, ''), description: text(item.description_snippet || item.description, '')
  };
};
function collectVideos(source, limit = 80) {
  const out = [], ids = new Set(), seen = new WeakSet();
  function walk(node, depth = 0, inShorts = false) {
    if (!node || depth > 14 || out.length >= limit) return;
    if (Array.isArray(node)) return node.forEach(value => walk(value, depth + 1, inShorts));
    if (node instanceof Map) { for (const value of node.values()) walk(value, depth + 1, inShorts); return; }
    if (node instanceof Set) { for (const value of node.values()) walk(value, depth + 1, inShorts); return; }
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const type = String(node.type || node.constructor?.type || node.constructor?.name || '');
    const endpoint = node.endpoint || node.navigation_endpoint || node.navigationEndpoint || node.on_tap_endpoint || node.onTapEndpoint || {};
    const payload = endpoint.payload || endpoint;
    const contentType = String(node.content_type || node.contentType || '').replace(/^LOCKUP_CONTENT_TYPE_/, '');
    const isShortNode = inShorts || contentType === 'SHORT' ||
      /ShortsLockupView|ReelItem/i.test(type) || /reelItemRenderer|shortsLockupViewModel/i.test(type) ||
      /reelWatchEndpoint/i.test(String(endpoint.name || endpoint.type || '')) ||
      Boolean(endpoint.reelWatchEndpoint || payload.reelWatchEndpoint || node.reelItemRenderer || node.shortsLockupViewModel || node.reel_item_renderer || node.shorts_lockup_view_model);
    const item = normalizeVideo(node);
    if (item && !ids.has(item.id)) {
      if (isShortNode) item.isShort = true;
      ids.add(item.id); out.push(item);
    }
    // YouTube.js feed structures differ by tab and parser version. Traverse all
    // enumerable renderer properties instead of assuming a small key list.
    for (const [key, value] of Object.entries(node)) {
      const childIsShort = isShortNode || /^(?:reelItemRenderer|shortsLockupViewModel|reel_item_renderer|shorts_lockup_view_model)$/i.test(key);
      walk(value, depth + 1, childIsShort);
    }
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
  const shortIds = new Set(collectShorts([memoSources, feed], limit).map(video => video.id));
  for (const video of [...direct, ...memoVideos, ...fallback]) {
    if (!video || ids.has(video.id)) continue;
    if (shortIds.has(video.id)) video.isShort = true;
    ids.add(video.id); output.push(video);
    if (output.length >= limit) break;
  }
  return output;
}

export {
  isImageHost,
  youtubePromise,
  text,
  formatViewCount,
  bestThumbnail,
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
