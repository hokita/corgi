export interface HNStory {
  id: string
  title: string
  url: string | null
  points: number
  comments: number
}

interface AlgoliaHit {
  objectID: string
  title: string | null
  url: string | null
  points: number | null
  num_comments: number | null
  _tags: string[]
}

interface AlgoliaResponse {
  hits: AlgoliaHit[]
}

const ALGOLIA_FRONT_PAGE_URL = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30'

export async function fetchTopStories(): Promise<HNStory[]> {
  const res = await fetch(ALGOLIA_FRONT_PAGE_URL)
  if (!res.ok) {
    throw new Error(`Algolia HN API responded with ${res.status}`)
  }
  const data = (await res.json()) as AlgoliaResponse
  return data.hits
    .filter((hit) => !hit._tags.includes('job') && !hit._tags.includes('poll') && hit.title)
    .map((hit) => ({
      id: hit.objectID,
      title: hit.title!,
      url: hit.url,
      points: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
    }))
}
