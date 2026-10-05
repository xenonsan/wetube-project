import { proxied } from './media.js';

async function executeVideoRating(yt, videoId, desiredStatus) {
  // youtubei.js 18.1.0 currently cannot parse the latest WEB /next response
  // (SingleColumnWatchNextResults and related renderers). Read the raw JSON,
  // extract YouTube's own likeEndpoint, then execute that exact payload.
  const response = await yt.actions.execute('/next', { videoId, client: 'WEB' });
  const root = response?.data || response;
  const candidates = [];
  const seen = new WeakSet();
  function walk(node, depth = 0) {
    if (!node || depth > 25) return;
    if (Array.isArray(node)) { for (const value of node) walk(value, depth + 1); return; }
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.likeEndpoint && typeof node.likeEndpoint === 'object') candidates.push(node.likeEndpoint);
    for (const value of Object.values(node)) walk(value, depth + 1);
  }
  walk(root);
  const normalized = value => String(value || '').replace('LIKE_STATUS_', '').toUpperCase();
  const target = candidates.find(endpoint => normalized(endpoint.status) === desiredStatus) ||
    candidates.find(endpoint => desiredStatus === 'LIKE' && normalized(endpoint.status) === 'LIKE') ||
    candidates.find(endpoint => desiredStatus === 'INDIFFERENT' && ['INDIFFERENT','NONE'].includes(normalized(endpoint.status)));
  if (!target) {
    const error = new Error(`RATING_ENDPOINT_NOT_FOUND:${desiredStatus}:${candidates.map(item => normalized(item.status)).filter(Boolean).join(',')}`);
    error.status = 422;
    throw error;
  }
  const path = desiredStatus === 'LIKE' ? '/like/like' : '/like/removelike';
  const result = await yt.actions.execute(path, { ...target, client: 'WEB' });
  if (!result?.success) {
    const error = new Error(`RATING_REQUEST_FAILED:${result?.status_code || 'unknown'}`);
    error.status = result?.status_code || 502;
    throw error;
  }
  return result;
}

const rawText = value => {
  if (typeof value === 'string') return value;
  return value?.simpleText || value?.text || value?.runs?.map(run => run.text).join('') || value?.content || '';
};
const rawThumb = value => {
  const list = value?.thumbnails || value?.thumbnail?.thumbnails || value?.image?.sources || value?.image?.thumbnails || [];
  const url = Array.isArray(list) ? list.at(-1)?.url || '' : '';
  return proxied(String(url).startsWith('//') ? `https:${url}` : url);
};
function walkRaw(root, visitor, maxDepth = 35) {
  const seen = new WeakSet();
  function walk(node, depth = 0) {
    if (!node || depth > maxDepth) return;
    if (Array.isArray(node)) { for (const value of node) walk(value, depth + 1); return; }
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node); visitor(node);
    for (const value of Object.values(node)) walk(value, depth + 1);
  }
  walk(root);
}
function rawVideos(root, limit = 500) {
  const output = [], ids = new Set();
  walkRaw(root, node => {
    if (output.length >= limit) return;
    const renderer = node.videoRenderer || node.gridVideoRenderer || node.compactVideoRenderer || node.playlistVideoRenderer || node.reelItemRenderer || node.shortsLockupViewModel || node.lockupViewModel || node.tileRenderer;
    if (!renderer) return;
    const endpoint = renderer.navigationEndpoint || renderer.onTap?.innertubeCommand || renderer.rendererContext?.commandContext?.onTap?.innertubeCommand || {};
    const id = renderer.videoId || renderer.video_id || renderer.contentId || endpoint.watchEndpoint?.videoId || endpoint.reelWatchEndpoint?.videoId;
    const contentType = String(renderer.contentType || renderer.content_type || '');
    if (!/^[\w-]{11}$/.test(String(id || '')) || ids.has(id) || /PLAYLIST|CHANNEL/.test(contentType)) return;
    const metadataRows = renderer.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || renderer.metadata?.metadataRows || [];
    const metadata = metadataRows.flatMap(row => row.metadataParts || []).map(part => rawText(part.text)).filter(Boolean);
    const author = rawText(renderer.ownerText || renderer.shortBylineText || renderer.longBylineText) || metadata[0] || 'YouTube';
    const views = rawText(renderer.viewCountText || renderer.shortViewCountText) || metadata.find(value => /回視聴|views?/i.test(value)) || '';
    const published = rawText(renderer.publishedTimeText) || metadata.find(value => /前| ago|公開|配信/i.test(value)) || '';
    ids.add(id); output.push({ id, title: rawText(renderer.title || renderer.headline) || '動画', author, authorId: renderer.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '', authorThumbnail: rawThumb(renderer.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail), thumbnail: rawThumb(renderer.thumbnail || renderer.thumbnailViewModel?.image), duration: rawText(renderer.lengthText || renderer.thumbnailOverlays?.find?.(item => item.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text), views, published, description: rawText(renderer.descriptionSnippet), isShort: Boolean(renderer.reelItemRenderer || renderer.shortsLockupViewModel || endpoint.reelWatchEndpoint || /SHORT/.test(contentType)) });
  });
  return output;
}
function rawChannels(root, limit = 500) {
  const output = [], ids = new Set();
  walkRaw(root, node => {
    if (output.length >= limit) return;
    const renderer = node.channelRenderer || node.gridChannelRenderer || node.channelListItemRenderer || node.lockupViewModel || node.tileRenderer;
    if (!renderer) return;
    const endpoint = renderer.navigationEndpoint || renderer.rendererContext?.commandContext?.onTap?.innertubeCommand || {};
    const id = renderer.channelId || renderer.channel_id || renderer.contentId || endpoint.browseEndpoint?.browseId;
    const contentType = String(renderer.contentType || '');
    if (!/^UC[\w-]{20,}$/.test(String(id || '')) || ids.has(id) || /VIDEO|PLAYLIST|SHORT/.test(contentType)) return;
    const metadataRows = renderer.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
    const metadata = metadataRows.flatMap(row => row.metadataParts || []).map(part => rawText(part.text)).filter(Boolean);
    const tileHeader = renderer.header?.tileHeaderRenderer || {};
    const tileMeta = renderer.metadata?.tileMetadataRenderer || {};
    ids.add(id); output.push({ id, name: rawText(renderer.title || renderer.channelName || tileMeta.title) || renderer.metadata?.lockupMetadataViewModel?.title?.content || 'チャンネル', handle: rawText(renderer.subscriberCountText) || metadata.find(value => value.startsWith('@')) || '', subscribers: rawText(renderer.subscriberCountText) || metadata.find(value => /登録者|subscribers?/i.test(value)) || '', videos: rawText(renderer.videoCountText), description: rawText(renderer.descriptionSnippet), thumbnail: rawThumb(renderer.thumbnail || renderer.avatar || tileHeader.thumbnail || renderer.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image) });
  });
  return output;
}
function rawContinuation(root) {
  let token = '';
  walkRaw(root, node => { if (!token) token = node.continuationCommand?.token || node.continuationEndpoint?.continuationCommand?.token || ''; });
  return token;
}
async function collectRawBrowse(yt, initial, extractor, limit = 500, pages = 20) {
  const output = [], ids = new Set(); let response = initial;
  for (let page = 0; response && page < pages && output.length < limit; page++) {
    const root = response?.data || response;
    for (const item of extractor(root, limit)) if (!ids.has(item.id)) { ids.add(item.id); output.push(item); if (output.length >= limit) break; }
    const continuation = rawContinuation(root); if (!continuation || output.length >= limit) break;
    response = await yt.actions.execute('/browse', { continuation, client: 'WEB' });
  }
  return output;
}
async function accountLikedVideos(yt) {
  const response = await yt.actions.execute('/browse', { browseId: 'VLLL', client: 'WEB' });
  return collectRawBrowse(yt, response, rawVideos, 500, 20);
}
async function accountSubscribedChannels(yt) {
  const response = await yt.actions.execute('/browse', { browseId: 'FEchannels', client: 'WEB' });
  return collectRawBrowse(yt, response, rawChannels, 500, 20);
}

export {
  executeVideoRating,
  rawText,
  rawThumb,
  walkRaw,
  rawVideos,
  rawChannels,
  rawContinuation,
  collectRawBrowse,
  accountLikedVideos,
  accountSubscribedChannels
};

