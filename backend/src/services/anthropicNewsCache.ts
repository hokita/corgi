import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { fetchAnthropicNews, type AnthropicNewsPost } from '../tools/anthropicNews'

const TTL_MS = 24 * 60 * 60 * 1000
const CACHE_COLLECTION = 'anthropic_news_cache'
const CACHE_DOC_ID = 'posts'

export async function getCachedPosts(): Promise<AnthropicNewsPost[] | null> {
  const db = getFirestore()
  const doc = await db.collection(CACHE_COLLECTION).doc(CACHE_DOC_ID).get()
  if (!doc.exists) return null
  const data = doc.data()!
  const fetchedAt = (data.fetchedAt as Timestamp).toDate()
  if (Date.now() - fetchedAt.getTime() > TTL_MS) return null
  return data.posts as AnthropicNewsPost[]
}

export async function setCachedPosts(posts: AnthropicNewsPost[]): Promise<void> {
  const db = getFirestore()
  await db.collection(CACHE_COLLECTION).doc(CACHE_DOC_ID).set({
    posts,
    fetchedAt: Timestamp.now(),
  })
}

export async function getAnthropicNews(): Promise<AnthropicNewsPost[]> {
  const cached = await getCachedPosts()
  if (cached) return cached
  const posts = await fetchAnthropicNews()
  await setCachedPosts(posts)
  return posts
}
