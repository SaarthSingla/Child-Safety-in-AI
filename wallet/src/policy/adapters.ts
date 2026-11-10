// Generated from policy/src by `npm run sync` in policy/. Do not edit here.
type Json = Record<string, any>;

// Each platform describes content differently. An adapter copies only what a
// platform really says into one standard shape, and leaves everything else
// missing. Missing means "not checked", so the rules can treat it safely.
export type RawRecord = {
  content_id: string;
  title?: string;
  platform?: string;
  topics?: string[];
  features?: string[];
  format?: string;
  rating_age?: number;
  live?: boolean;
};

const CBFC: Record<string, number> = {
  cbfcU: 0,
  cbfcUA: 13,
  cbfcUA7plus: 7,
  cbfcUA13plus: 13,
  cbfcUA16plus: 16,
  cbfcA: 18,
  cbfcS: 18,
};

const MPAA: Record<string, number> = { mpaaG: 0, mpaaPg: 7, mpaaPg13: 13, mpaaR: 17, mpaaNc17: 18 };

function strictest(values: (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length ? Math.max(...known) : undefined;
}

// YouTube Data API: a "video" resource.
export function fromYouTube(video: Json): RawRecord {
  const snippet = video.snippet ?? {};
  const details = video.contentDetails ?? {};
  const ratings = details.contentRating ?? {};
  const status = video.status ?? {};
  const live = snippet.liveBroadcastContent;

  const record: RawRecord = { content_id: `youtube:${video.id}`, platform: 'youtube', format: 'video' };
  if (typeof snippet.title === 'string') record.title = snippet.title;

  const rating = strictest([
    ratings.ytRating === 'ytAgeRestricted' ? 18 : undefined,
    CBFC[ratings.cbfcRating],
    MPAA[ratings.mpaaRating],
  ]);
  if (rating !== undefined) record.rating_age = rating;
  // "Made for kids" is a claim about the audience. It only counts as a rating
  // when nothing stronger exists, and only when it is true.
  else if (status.madeForKids === true) record.rating_age = 0;

  if (live === 'live' || live === 'upcoming') {
    record.live = true;
    record.format = 'live_stream';
  } else if (live === 'none') {
    record.live = false;
  }

  if (video.liveStreamingDetails?.activeLiveChatId) record.features = ['chat'];
  return record;
}

// Instagram media: no topic, age or language field exists.
export function fromInstagram(media: Json): RawRecord {
  const record: RawRecord = { content_id: `instagram:${media.id}`, platform: 'instagram' };
  if (typeof media.caption === 'string') record.title = media.caption;
  if (media.media_type === 'VIDEO') record.format = media.media_product_type === 'REELS' ? 'short' : 'video';
  return record;
}

// X post: "possibly_sensitive" is the only maturity-like signal.
export function fromX(post: Json): RawRecord {
  const record: RawRecord = { content_id: `x:${post.id}`, platform: 'x', format: 'article' };
  if (typeof post.text === 'string') record.title = post.text;
  if (post.possibly_sensitive === true) record.rating_age = 18;
  return record;
}

// Spotify track: explicit=false can also mean "unknown", so only true counts.
export function fromSpotify(track: Json): RawRecord {
  const record: RawRecord = { content_id: `spotify:${track.id}`, platform: 'spotify', format: 'audio' };
  if (typeof track.name === 'string') record.title = track.name;
  if (track.explicit === true) record.rating_age = 16;
  return record;
}

const KEYWORDS: Record<string, string[]> = {
  'news/war': ['war', 'airstrike', 'missile', 'युद्ध', 'jung', 'yuddh'],
  'news/politics': ['election', 'parliament', 'चुनाव', 'chunav'],
  'harm/self-harm': ['suicide', 'self harm', 'आत्महत्या'],
  'harm/gambling': ['betting', 'casino', 'satta', 'जुआ'],
  'harm/drugs': ['cocaine', 'heroin', 'नशा'],
  science: ['science', 'विज्ञान', 'vigyan'],
  'games/gambling': ['slots', 'poker'],
};

// A simple word list that stands in for a real on-device classifier. It can
// only output vocabulary terms, so a crafted title cannot do anything except
// fail to match. If nothing matches, the topics stay "not checked".
export function fillTopicsFromText(record: RawRecord): RawRecord {
  if (record.topics || !record.title) return record;
  const text = ` ${record.title.toLowerCase()} `;
  const found = Object.entries(KEYWORDS)
    .filter(([, words]) => words.some((word) => new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, 'u').test(text)))
    .map(([topic]) => topic);
  return found.length ? { ...record, topics: found } : record;
}
