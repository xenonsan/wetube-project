const memory = new Map();
const EDU_PARAM_SOURCES = [
  { name: 'siawaseok', url: 'https://raw.githubusercontent.com/siawaseok3/wakame/master/video_config.json', field: 'params' },
  { name: 'Toka_Kun key1', url: 'https://raw.githubusercontent.com/toka-kun/Education/refs/heads/main/keys/key1.json', field: 'result' },
  { name: 'Toka_Kun key2', url: 'https://raw.githubusercontent.com/toka-kun/Education/refs/heads/main/keys/key2.json', field: 'result' },
  { name: 'Toka_Kun key3', url: 'https://raw.githubusercontent.com/toka-kun/Education/refs/heads/main/keys/key3.json', field: 'result' },
  { name: 'Toka_Kun key4', url: 'https://raw.githubusercontent.com/toka-kun/Education/refs/heads/main/keys/key4.json', field: 'result' },
  { name: 'woolisbest 1', url: 'https://raw.githubusercontent.com/wista-api-project/auto/refs/heads/main/edu/1.txt', field: 'text' },
  { name: 'woolisbest 2', url: 'https://raw.githubusercontent.com/wista-api-project/auto/refs/heads/main/edu/2.txt', field: 'text' },
  { name: 'woolisbest 3', url: 'https://raw.githubusercontent.com/wista-api-project/auto/refs/heads/main/edu/3.txt', field: 'text' },
  { name: 'woolisbest 4', url: 'https://raw.githubusercontent.com/wista-api-project/auto/refs/heads/main/edu/4.txt', field: 'text' },
  { name: 'woolisbest 5', url: 'https://raw.githubusercontent.com/wista-api-project/auto/refs/heads/main/edu/5.txt', field: 'text' },
  { name: 'woolisbest 6', url: 'https://raw.githubusercontent.com/wista-api-project/auto/refs/heads/main/edu/6.txt', field: 'text' },
  { name: 'wakame', url: 'https://raw.githubusercontent.com/wakame02/wktopu/refs/heads/main/edu.text', field: 'text' }
];
const EDU_FALLBACK = '?autoplay=1&mute=0&controls=1&playsinline=1&rel=0';
let eduCache = { params: EDU_FALLBACK, sources: [], expires: 0 };

function cached(key, ttl, loader) {
  const hit = memory.get(key);
  if (hit?.expires > Date.now()) return hit.value;
  const value = Promise.resolve().then(loader).catch(error => {
    memory.delete(key);
    throw error;
  });
  memory.set(key, { value, expires: Date.now() + ttl });
  if (memory.size > 500) memory.delete(memory.keys().next().value);
  return value;
}

function userCached(req, key, ttl, loader) {
  return cached(`user:${req.wetubeSessionId}:${key}`, ttl, loader);
}

function normalizeEduParam(value) {
  if (typeof value !== 'string') return '';
  const decoded = value.trim().replaceAll('&amp;', '&');
  return decoded.startsWith('?') ? decoded : '';
}

async function fetchEduSource(source) {
  try {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(4500), headers: { accept: 'application/json,text/plain,*/*' } });
    if (!response.ok) return null;
    const raw = await response.text();
    let value = raw;
    if (source.field !== 'text') {
      const json = JSON.parse(raw);
      value = json?.[source.field];
    }
    const params = normalizeEduParam(value);
    return params ? { name: source.name, params } : null;
  } catch {
    return null;
  }
}

async function eduParamSources() {
  if (eduCache.expires > Date.now() && eduCache.sources.length) return eduCache.sources;
  const results = (await Promise.all(EDU_PARAM_SOURCES.map(fetchEduSource))).filter(Boolean);
  if (results.length) {
    eduCache = { params: results[0].params, sources: results, expires: Date.now() + 600000 };
  } else {
    eduCache.expires = Date.now() + 60000;
  }
  return eduCache.sources;
}

async function eduParams(EDU_CONFIG) {
  const sources = await eduParamSources();
  return sources[0]?.params || EDU_FALLBACK;
}

export { memory, cached, userCached, eduParams, eduParamSources };

