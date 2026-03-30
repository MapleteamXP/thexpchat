export interface YoutubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  author: string;
  lengthSeconds: number;
}

// Reliable Invidious instances (community-run YouTube frontends)
// These provide API access without CORS issues and without API keys
const INVIDIOUS_INSTANCES = [
  'https://iv.datura.network',
  'https://iv.nboeck.de',
  'https://vid.puffyan.us',
  'https://y.com.sb',
  'https://iv.melmac.space',
  'https://iv.nboeck.de',
  'https://iv.datura.network',
];

const SEARCH_TIMEOUT = 8000; // 8 seconds per instance

async function searchWithInstance(
  instance: string,
  query: string,
  signal: AbortSignal
): Promise<YoutubeVideo[]> {
  const response = await fetch(
    `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
    { signal, headers: { Accept: 'application/json' } }
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  return data
    .filter((item: any) => item.type === 'video')
    .slice(0, 10)
    .map((item: any) => {
      let thumbnailUrl = item.videoThumbnails?.[0]?.url || '';
      
      // Some instances return relative URLs, others absolute
      if (thumbnailUrl && !thumbnailUrl.startsWith('http')) {
        thumbnailUrl = `${instance}${thumbnailUrl}`;
      }
      
      // Fallback to YouTube's own thumbnail CDN if still missing
      if (!thumbnailUrl) {
        thumbnailUrl = `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`;
      }

      return {
        id: item.videoId,
        title: item.title,
        thumbnail: thumbnailUrl,
        author: item.author || item.authorId || 'Unknown',
        lengthSeconds: item.lengthSeconds || 0,
      };
    });
}

export async function searchYoutube(query: string): Promise<YoutubeVideo[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Shuffle instances so we don't always hammer the same one first
  const shuffled = [...INVIDIOUS_INSTANCES].sort(() => Math.random() - 0.5);
  const errors: string[] = [];

  for (const instance of shuffled) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);

    try {
      const results = await searchWithInstance(instance, trimmed, controller.signal);
      clearTimeout(timeoutId);
      if (results.length > 0) {
        return results;
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      errors.push(`${instance}: ${err.message || err}`);
      console.warn(`YouTube search failed on ${instance}:`, err);
      // Continue to next instance
    }
  }

  // Last resort: try YouTube's own thumbnail + a no-CORS direct search hint
  console.error('All Invidious instances failed:', errors);
  
  // If all instances fail, we can at least return empty array
  // In the future, a backend proxy could be added here
  return [];
}
