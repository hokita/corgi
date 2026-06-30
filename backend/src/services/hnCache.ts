import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { fetchTopStories, type HNStory } from '../tools/hackernews'

const TTL_MS = 6 * 60 * 60 * 1000
const CACHE_COLLECTION = 'hn_cache'
const CACHE_DOC_ID = 'stories'

export async function getCachedStories(): Promise<HNStory[] | null> {
  const db = getFirestore()
  const doc = await db.collection(CACHE_COLLECTION).doc(CACHE_DOC_ID).get()
  if (!doc.exists) return null
  const data = doc.data()!
  const fetchedAt = (data.fetchedAt as Timestamp).toDate()
  if (Date.now() - fetchedAt.getTime() > TTL_MS) return null
  return data.stories as HNStory[]
}

export async function setCachedStories(stories: HNStory[]): Promise<void> {
  const db = getFirestore()
  await db.collection(CACHE_COLLECTION).doc(CACHE_DOC_ID).set({
    stories,
    fetchedAt: Timestamp.now(),
  })
}

export async function getHNStories(): Promise<HNStory[]> {
  const cached = await getCachedStories()
  if (cached) return cached
  const stories = await fetchTopStories()
  await setCachedStories(stories)
  return stories
}
