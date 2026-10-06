import { YTNodes } from 'youtubei.js';
import { collectVideos, normalizeFeedVideos, normalizeVideo, proxied, rawImage, text } from './media.js';

async function executeVideoRating(yt, videoId, desiredStatus) {
  const currentStatus = await accountVideoRatingStatus(yt, videoId);
  if (currentStatus === desiredStatus) {
    return { success: true, status_code: 200, unchanged: true, ratingStatus: currentStatus };
  }
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
  const target = candidates.find(endpoint =>
    endpoint.target?.videoId === videoId &&
    normalized(endpoint.status) === desiredStatus
  );
  if (!target) {
    const error = new Error(`RATING_ENDPOINT_NOT_FOUND:${desiredStatus}:${candidates.map(item => normalized(item.status)).filter(Boolean).join(',')}`);
    error.status = 422;
    throw error;
  }
  const path = desiredStatus === 'LIKE' ? '/like/like'
    : desiredStatus === 'DISLIKE' ? '/like/dislike'
      : '/like/removelike';
  const result = await yt.actions.execute(path, { ...target, client: 'WEB' });
  if (!result?.success) {
    const error = new Error(`RATING_REQUEST_FAILED:${result?.status_code || 'unknown'}`);
    error.status = result?.status_code || 502;
    throw error;
  }
  const actualStatus = await accountVideoRatingStatus(yt, videoId);
  if (actualStatus !== desiredStatus) {
    const error = new Error(`RATING_STATE_MISMATCH:${desiredStatus}:${actualStatus}`);
    error.status = 502;
    throw error;
  }
  return { ...result, ratingStatus: actualStatus };
}

const rawText = (value, fallback = '') => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(item => rawText(item)).join('') || fallback;
  if (typeof value?.simpleText === 'string') return value.simpleText;
  if (typeof value?.simple_text === 'string') return value.simple_text;
  if (typeof value?.text === 'string') return value.text;
  if (value?.text && typeof value.text === 'object') return rawText(value.text, fallback);
  if (Array.isArray(value?.runs)) return value.runs.map(run => rawText(run?.text)).join('') || fallback;
  if (typeof value?.content === 'string') return value.content;
  if (value?.content && typeof value.content === 'object') return rawText(value.content, fallback);
  const rendered = value?.toString?.();
  return rendered && rendered !== '[object Object]' ? rendered : fallback;
};
const rawThumb = value => {
  const urls = [], seen = new WeakSet();
  function walk(node, depth = 0) {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) return node.forEach(item => walk(item, depth + 1));
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (typeof node.url === 'string') urls.push(node.url);
    for (const key of ['sources', 'thumbnails', 'thumbnail', 'thumbnailViewModel', 'thumbnail_view_model', 'primaryThumbnail', 'primary_thumbnail', 'collectionThumbnailViewModel', 'image', 'avatar', 'avatarViewModel', 'decoratedAvatarViewModel', 'contentImage', 'content_image']) {
      walk(node[key], depth + 1);
    }
  }
  walk(value);
  const url = urls.at(-1) || '';
  return proxied(url.startsWith('//') ? `https:${url}` : url);
};
const authorName = value => {
  const text = rawText(value).trim();
  return text && !/^(?:N\/A|YouTube|チャンネル|動画)$/i.test(text) ? text : '';
};
const channelIdFrom = (...values) => {
  let id = '';
  walkRaw(values, node => {
    if (id) return;
    const candidate = node.browseEndpoint?.browseId || node.browse_endpoint?.browseId ||
      node.browse_endpoint?.browse_id || node.browseId || node.channelId || node.channel_id;
    if (/^UC[\w-]{20,}$/.test(String(candidate || ''))) id = String(candidate);
  }, 16);
  return id;
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
    const endpoint = renderer.navigationEndpoint || renderer.onTap?.innertubeCommand || renderer.onTapEndpoint?.innertubeCommand || renderer.endpoint || renderer.rendererContext?.commandContext?.onTap?.innertubeCommand || {};
    const rawId = renderer.videoId || renderer.video_id || renderer.contentId || renderer.content_id ||
      endpoint.watchEndpoint?.videoId || endpoint.reelWatchEndpoint?.videoId ||
      endpoint.payload?.videoId || endpoint.payload?.video_id;
    const id = String(rawId || '').replace(/^(?:video|shorts):/, '');
    const contentType = String(renderer.contentType || renderer.content_type || '');
    if (!/^[\w-]{11}$/.test(String(id || '')) || ids.has(id) || /PLAYLIST|CHANNEL/.test(contentType)) return;
    const lockup = renderer.metadata?.lockupMetadataViewModel || renderer.metadata?.lockup_metadata_view_model || renderer.lockupMetadataViewModel || renderer.lockup_metadata_view_model || {};
    const rows = renderer.metadata?.metadataRows || renderer.metadata?.metadata_rows ||
      lockup.metadata?.contentMetadataViewModel?.metadataRows || lockup.metadata?.content_metadata_view_model?.metadata_rows || [];
    const metadata = rows.flatMap(row => row.metadataParts || row.metadata_parts || []).map(part => rawText(part.text ?? part)).filter(Boolean);
    const ownerText = renderer.ownerText || renderer.shortBylineText || renderer.longBylineText || renderer.owner_text || renderer.byline;
    const owner = renderer.owner || renderer.author || renderer.channel || {};
    const ownerCandidate = [owner.name, owner, ownerText, renderer.channelName, renderer.channel_name].map(authorName).find(Boolean);
    const metadataOwner = metadata.find(value => !/^@/.test(value) && !/回視聴|視聴回数|views?|登録者|subscribers?|本の動画|videos?|前| ago|公開|配信/i.test(value)) || '';
    const author = ownerCandidate || authorName(metadataOwner) || '';
    const views = rawText(renderer.viewCountText || renderer.shortViewCountText || renderer.view_count_text) || metadata.find(value => /回視聴|views?/i.test(value)) || '';
    const published = rawText(renderer.publishedTimeText || renderer.published_time_text) || metadata.find(value => /前| ago|公開|配信/i.test(value)) || '';
    const ownerLink = ownerText?.runs?.find?.(run => run.navigationEndpoint?.browseEndpoint?.browseId || run.navigation_endpoint?.browseEndpoint?.browseId);
    const thumbnail = renderer.thumbnail || renderer.thumbnailViewModel?.image || renderer.thumbnailViewModel || renderer.thumbnail_view_model?.image || renderer.thumbnail_view_model;
    const channelThumbnail = renderer.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail ||
      renderer.channelThumbnail?.channelThumbnailRenderer?.thumbnail || renderer.channelThumbnail || renderer.avatar || owner?.thumbnails;
    const idsFromOwner = channelIdFrom(ownerLink, owner, renderer.metadata?.image, renderer.contentImage, renderer.rendererContext?.commandContext?.onTap);
    ids.add(id); output.push({
      id: String(id),
      title: rawText(renderer.title || renderer.headline || renderer.overlayMetadata?.primaryText || lockup.title || renderer.metadata?.title, `動画 (${id})`),
      author,
      authorId: idsFromOwner || '',
      authorThumbnail: rawThumb(channelThumbnail),
      thumbnail: rawThumb(thumbnail) || proxied(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`),
      duration: rawText(renderer.lengthText || renderer.thumbnailOverlays?.find?.(item => item.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text || renderer.length_text),
      views, published, description: rawText(renderer.descriptionSnippet || renderer.description_snippet),
      isShort: Boolean(
        node.reelItemRenderer || node.shortsLockupViewModel ||
        renderer.reelItemRenderer || renderer.shortsLockupViewModel ||
        endpoint.reelWatchEndpoint || /SHORT/.test(contentType)
      )
    });
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
    const lockup = renderer.metadata?.lockupMetadataViewModel || renderer.metadata?.lockup_metadata_view_model || {};
    const metadataRows = renderer.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows ||
      renderer.metadata?.lockup_metadata_view_model?.metadata?.content_metadata_view_model?.metadata_rows || [];
    const metadata = metadataRows.flatMap(row => row.metadataParts || row.metadata_parts || []).map(part => rawText(part.text ?? part)).filter(Boolean);
    const tileHeader = renderer.header?.tileHeaderRenderer || {};
    const tileMeta = renderer.metadata?.tileMetadataRenderer || {};
    const title = rawText(renderer.title || renderer.channelName || renderer.channel_name || tileMeta.title || lockup.title || renderer.header?.title);
    const name = authorName(title) || metadata.find(value => !/^@/.test(value) && !/登録者|subscribers?|本の動画|videos?/i.test(value)) || '';
    ids.add(id); output.push({
      id, name: authorName(name) || 'チャンネル',
      handle: rawText(renderer.subscriberCountText || renderer.subscriber_count_text) || metadata.find(value => value.startsWith('@')) || '',
      subscribers: rawText(renderer.videoCountText || renderer.video_count_text) || metadata.find(value => /登録者|subscribers?/i.test(value)) || '',
      videos: '', description: rawText(renderer.descriptionSnippet || renderer.description_snippet),
      thumbnail: rawThumb(renderer.thumbnail || renderer.avatar || tileHeader.thumbnail || renderer.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image || lockup.image)
    });
  });
  return output;
}
async function accountLikedVideos(yt) {
  const library = await yt.getLibrary();
  const shelf = library?.liked_videos;
  if (!shelf) return [];
  const videos = new Map();
  const add = items => {
    for (const item of items || []) {
      const video = normalizeVideo(item);
      if (video?.id && !videos.has(video.id)) videos.set(video.id, video);
    }
  };
  add(shelf.contents);
  try {
    const feed = await shelf.getAll();
    add(feed?.videos);
    if (typeof feed?.getContinuation === 'function') {
      let current = feed;
      for (let page = 0; current?.has_continuation && page < 19 && videos.size < 500; page++) {
        current = await current.getContinuation();
        add(current?.videos);
      }
    }
  } catch (error) {
    if (!videos.size) throw error;
    console.warn('Liked videos continuation unavailable; showing the loaded shelf:', error?.message || error);
  }
  return [...videos.values()].slice(0, 500);
}
function rawContinuation(root) {
  let token = '';
  walkRaw(root, node => { if (!token) token = node.continuationCommand?.token || node.continuationEndpoint?.continuationCommand?.token || ''; });
  return token;
}
async function collectRawBrowse(yt, initial, extractor, limit = 500, pages = 20) {
  const output = [], ids = new Set(); let response = initial;
  for (let page = 0; response && page < pages && output.length < limit; page++) {
    if (response?.success === false) {
      const error = new Error(`BROWSE_HTTP_${response.status_code || 'UNKNOWN'}`);
      error.status = response.status_code || 502;
      throw error;
    }
    const root = response?.data || response;
    for (const item of extractor(root, limit)) if (!ids.has(item.id)) { ids.add(item.id); output.push(item); if (output.length >= limit) break; }
    const continuation = rawContinuation(root); if (!continuation || output.length >= limit) break;
    response = await yt.actions.execute('/browse', { continuation, client: 'WEB' });
  }
  return output;
}
async function collectWithRawFallback(loadFeed, getItems, normalize, yt, browseId, extractor) {
  let parsedError;
  try {
    const parsed = await collectParsedFeed(loadFeed, getItems, normalize);
    if (parsed.length) return parsed;
  } catch (error) {
    parsedError = error;
  }

  try {
    const initial = await yt.actions.execute('/browse', { browseId, client: 'WEB' });
    const raw = await collectRawBrowse(yt, initial, extractor);
    if (raw.length || !parsedError) return raw;
  } catch (error) {
    if (!parsedError) throw error;
  }

  throw parsedError;
}
async function accountSubscribedChannels(yt) {
  const normalizeChannel = channel => {
    const id = String(channel.id || '');
    if (!/^UC[\w-]{20,}$/.test(id)) return null;
    return {
      id,
      name: text(channel.author?.name, 'チャンネル'),
      handle: text(channel.subscriber_count, ''),
      subscribers: text(channel.subscribers || channel.video_count, ''),
      videos: '',
      description: text(channel.description_snippet, ''),
      thumbnail: proxied(rawImage(channel.author))
    };
  };
  return collectWithRawFallback(
    () => yt.getChannelsFeed(),
    feed => feed.channels,
    normalizeChannel,
    yt,
    'FEchannels',
    rawChannels
  );
}
function normalizeAccountHistoryFeed(feed, limit = 500) {
  const videos = [], ids = new Set();
  const normalizeItem = item => {
    const type = String(item?.type || item?.constructor?.type || '');
    if (type !== 'Tile') return normalizeVideo(item);
    const lines = Array.from(item.metadata?.lines || []).map(line =>
      Array.from(line?.items || []).map(entry => text(entry?.text || entry, '')).filter(Boolean).join('')
    ).filter(Boolean);
    const title = text(item.metadata?.title || item.endpoint?.payload?.title || item.title, '') || lines[0] || '';
    const author = lines.find(value => !/回視聴|視聴回数|views?|登録者|subscribers?|公開|前|ago/i.test(value)) || '';
    return normalizeVideo({
      ...item,
      title: title || `動画 (${item.content_id || ''})`,
      thumbnail: item.header?.thumbnail || item.thumbnail,
      thumbnails: item.header?.thumbnail || item.thumbnails,
      author: author ? { name: author } : item.author
    });
  };
  const add = items => {
    for (const item of items || []) {
      if (videos.length >= limit) return;
      const video = normalizeItem(item);
      if (!video || ids.has(video.id)) continue;
      const type = String(item?.type || item?.constructor?.type || '');
      const endpoint = item?.endpoint || item?.navigation_endpoint || item?.navigationEndpoint || {};
      const payload = endpoint?.payload || endpoint;
      video.isShort = Boolean(item?.isShort) || type === 'ReelItem' || type === 'ShortsLockupView' ||
        (/^(?:LockupView|Tile)$/.test(type) && /SHORT/.test(String(item.content_type || ''))) ||
        Boolean(endpoint.reelWatchEndpoint || payload.reelWatchEndpoint);
      ids.add(video.id);
      videos.push(video);
      if (videos.length >= limit) return;
    }
  };

  // History sections can contain nested item wrappers rather than video nodes
  // directly. Traverse each section independently, never the full page memo,
  // which can include unrelated Shorts shelves.
  for (const grid of feed?.memo?.getType?.(YTNodes.Grid) || []) {
    add(grid?.items);
    if (videos.length >= limit) break;
  }
  if (!videos.length) add(feed?.memo?.get?.('Tile'));
  const sections = Array.from(feed?.sections || []);
  if (!videos.length) {
    for (const section of sections) {
      add(collectVideos(section?.contents || [], limit));
      if (videos.length >= limit) break;
    }
  }
  if (!videos.length) add(feed?.videos);
  return videos;
}
function accountHistoryContinuationToken(feed) {
  const gridToken = Array.from(feed?.memo?.getType?.(YTNodes.Grid) || [])
    .map(grid => grid?.continuation)
    .find(Boolean);
  const sectionToken = Array.from(feed?.sections || [])
    .map(section => section?.continuation)
    .find(Boolean);
  return gridToken || sectionToken || feed?.page?.continuation_contents?.continuation || '';
}
function accountHistoryContinuation(feed) {
  const sections = Array.from(feed?.sections || []);
  const continuation = feed?.memo?.getType?.(YTNodes.ContinuationItem, YTNodes.ContinuationItemView)
    ?.find(item => !sections.some(section => section?.contents?.includes(item)));
  return continuation?.endpoint || null;
}
function accountHistoryHasMore(feed) {
  return Boolean(feed?.has_continuation || accountHistoryContinuation(feed) || accountHistoryContinuationToken(feed));
}
async function nextAccountHistoryFeed(feed) {
  if (feed?.has_continuation && typeof feed.getContinuation === 'function') {
    return feed.getContinuation();
  }
  const endpoint = accountHistoryContinuation(feed);
  if (endpoint && typeof endpoint.call === 'function') {
    const response = await endpoint.call(feed.actions, { parse: true });
    return new feed.constructor(feed.actions, response, true);
  }
  const continuation = accountHistoryContinuationToken(feed);
  if (continuation && typeof feed?.actions?.execute === 'function' && typeof feed?.constructor === 'function') {
    const response = await feed.actions.execute('/browse', { continuation, parse: true });
    return new feed.constructor(feed.actions, response, true);
  }
  throw new Error('No continuation data found in YouTube watch history');
}
async function accountWatchHistoryFeed(yt) {
  const feeds = [], errors = [];
  const tryFeed = async load => {
    try {
      const feed = await load();
      if (feed) feeds.push(feed);
    } catch (error) {
      errors.push(error);
    }
  };

  await tryFeed(() => yt.getHistory());
  await tryFeed(async () => {
    const library = await yt.getLibrary();
    return library?.history ? library.history.getAll() : null;
  });
  feeds.sort((left, right) => {
    const score = feed => normalizeAccountHistoryFeed(feed, 500).length + (accountHistoryHasMore(feed) ? 500 : 0);
    return score(right) - score(left);
  });
  if (feeds.length) return feeds[0];
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Unable to retrieve YouTube account watch history');
  throw new Error('YouTube account watch history was not available');
}
async function nextAccountHistoryPage(session, limit = 40) {
  const videos = [];
  const add = item => {
    if (!item?.id || session.seen.has(item.id)) return;
    session.seen.add(item.id);
    videos.push(item);
  };
  while (session.pending.length && videos.length < limit) add(session.pending.shift());
  for (let attempt = 0; videos.length < limit && attempt < 8 && accountHistoryHasMore(session.feed); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    session.feed = await nextAccountHistoryFeed(session.feed);
    const pageVideos = normalizeAccountHistoryFeed(session.feed, 500);
    for (const item of pageVideos) {
      if (videos.length >= limit) {
        session.pending.push(item);
        continue;
      }
      add(item);
    }
  }
  return {
    videos,
    hasMore: Boolean(session.pending.length || accountHistoryHasMore(session.feed))
  };
}
async function accountWatchHistoryLatest(yt, limit = 50) {
  return normalizeAccountHistoryFeed(await accountWatchHistoryFeed(yt), limit);
}
async function accountVideoRatingStatus(yt, videoId) {
  const response = await yt.actions.execute('/next', { videoId, client: 'WEB' });
  if (!response?.success) {
    const error = new Error(`LIKE_STATUS_REQUEST_FAILED:${response?.status_code || 'unknown'}`);
    error.status = response?.status_code || 502;
    throw error;
  }
  const root = response?.data || response;
  const currentVideoId = root?.currentVideoEndpoint?.watchEndpoint?.videoId ||
    root?.currentVideoEndpoint?.reelWatchEndpoint?.videoId;
  if (currentVideoId && currentVideoId !== videoId) throw new Error('LIKE_STATUS_VIDEO_MISMATCH');

  const statuses = new Set();
  walkRaw(root, node => {
    const buttonVideoId = node.target?.videoId;
    const buttonStatus = String(node.likeStatus || '').toUpperCase();
    if (buttonVideoId === videoId && ['LIKE', 'INDIFFERENT', 'DISLIKE'].includes(buttonStatus)) {
      statuses.add(buttonStatus);
    }
    const entityStatus = String(node.likeStatusEntity?.likeStatus || '').toUpperCase();
    if (['LIKE', 'INDIFFERENT', 'DISLIKE'].includes(entityStatus)) statuses.add(entityStatus);

    const segment = node.segmentedLikeDislikeButtonViewModel;
    const viewModelStatus = String(segment?.likeButtonViewModel?.likeButtonViewModel?.likeStatusEntity?.likeStatus || '').toUpperCase();
    if (['LIKE', 'INDIFFERENT', 'DISLIKE'].includes(viewModelStatus)) statuses.add(viewModelStatus);
    const legacyToggle = node.segmentedLikeDislikeButtonRenderer?.likeButton?.toggleButtonRenderer?.isToggled;
    if (typeof legacyToggle === 'boolean') statuses.add(legacyToggle ? 'LIKE' : 'INDIFFERENT');
  });
  if (statuses.size === 1) {
    return statuses.values().next().value;
  }
  throw new Error(statuses.size ? 'LIKE_STATUS_AMBIGUOUS' : 'LIKE_STATUS_UNAVAILABLE');
}
async function accountVideoLikeStatus(yt, videoId) {
  return (await accountVideoRatingStatus(yt, videoId)) === 'LIKE';
}
async function accountChannelSubscription(yt, channelId) {
  const response = await yt.actions.execute('/browse', { browseId: channelId, client: 'WEB' });
  if (!response?.success) {
    const error = new Error(`CHANNEL_STATE_REQUEST_FAILED:${response?.status_code || 'unknown'}`);
    error.status = response?.status_code || 502;
    throw error;
  }

  let selected = null, unscoped = null;
  walkRaw(response.data || response, node => {
    const button = node.subscribeButtonRenderer || node.subscribeButtonViewModel;
    if (!button) return;
    if (button.channelId === channelId || button.channel_id === channelId) selected = button;
    else if (!button.channelId && !button.channel_id && !unscoped) unscoped = button;
  });
  const button = selected || unscoped;
  if (!button) throw new Error('CHANNEL_STATE_UNAVAILABLE');

  const stateValue = button.subscribed ??
    button.subscribeButtonContent?.subscribeState?.subscribed ??
    button.unsubscribeButtonContent?.subscribeState?.subscribed;
  if (typeof stateValue !== 'boolean') throw new Error('CHANNEL_STATE_UNAVAILABLE');
  const serviceEndpoints = [
    ...(Array.isArray(button.serviceEndpoints) ? button.serviceEndpoints : []),
    ...(Array.isArray(button.onSubscribeEndpoints) ? button.onSubscribeEndpoints : []),
    ...(Array.isArray(button.onUnsubscribeEndpoints) ? button.onUnsubscribeEndpoints : [])
  ];
  const endpoints = serviceEndpoints.flatMap(endpoint => {
    const authenticatedCommand = endpoint?.authDeterminedCommand?.authenticatedCommand;
    return authenticatedCommand ? [endpoint, authenticatedCommand] : [endpoint];
  });
  return { subscribed: stateValue, endpoints };
}
async function accountChannelSubscriptionStatus(yt, channelId) {
  return (await accountChannelSubscription(yt, channelId)).subscribed;
}
async function executeChannelSubscription(yt, channelId, desiredState) {
  const current = await accountChannelSubscription(yt, channelId);
  if (current.subscribed === desiredState) {
    return { success: true, status_code: 200, unchanged: true, subscribed: current.subscribed };
  }

  const endpointName = desiredState ? 'subscribeEndpoint' : 'unsubscribeEndpoint';
  const endpoint = current.endpoints.find(item =>
    item?.[endpointName] &&
    (!Array.isArray(item[endpointName].channelIds) || item[endpointName].channelIds.includes(channelId))
  );
  if (!endpoint) throw new Error(`CHANNEL_${desiredState ? 'SUBSCRIBE' : 'UNSUBSCRIBE'}_ENDPOINT_UNAVAILABLE`);

  const result = await yt.actions.execute(
    desiredState ? 'subscription/subscribe' : 'subscription/unsubscribe',
    endpoint[endpointName]
  );
  if (!result?.success) {
    const error = new Error(`CHANNEL_SUBSCRIPTION_REQUEST_FAILED:${result?.status_code || 'unknown'}`);
    error.status = result?.status_code || 502;
    throw error;
  }
  let updated;
  for (let attempt = 0; attempt < 10; attempt++) {
    updated = await accountChannelSubscription(yt, channelId);
    if (updated.subscribed === desiredState) break;
    if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (updated.subscribed !== desiredState) throw new Error('SUBSCRIPTION_STATE_MISMATCH');
  return { ...result, subscribed: updated.subscribed };
}
async function collectParsedFeed(loadFeed, getItems, normalize, limit = 500, pages = 20) {
  const output = [], ids = new Set();
  let feed = await loadFeed();
  for (let page = 0; feed && page < pages && output.length < limit; page++) {
    for (const node of Array.from(getItems(feed) || [])) {
      const item = normalize(node);
      if (item?.id && !ids.has(item.id)) {
        ids.add(item.id);
        output.push(item);
        if (output.length >= limit) break;
      }
    }
    if (!feed.has_continuation || typeof feed.getContinuation !== 'function' || output.length >= limit) break;
    feed = await feed.getContinuation();
  }
  return output;
}

export {
  executeVideoRating,
  rawText,
  rawThumb,
  walkRaw,
  rawVideos,
  rawChannels,
  accountLikedVideos,
  rawContinuation,
  collectRawBrowse,
  accountSubscribedChannels,
  normalizeAccountHistoryFeed,
  accountWatchHistoryFeed,
  nextAccountHistoryPage,
  accountWatchHistoryLatest,
  accountVideoLikeStatus,
  accountVideoRatingStatus,
  accountChannelSubscriptionStatus,
  executeChannelSubscription
};
