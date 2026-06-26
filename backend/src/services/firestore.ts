import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { IdeaCluster } from '../models/api'

export interface ConversationDoc {
  id: string
  uid: string
  title: string
  lastMessage: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface FirestoreMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  suggestions?: string[]
  clusters?: IdeaCluster[]
}

export async function createConversation(uid: string, title: string): Promise<string> {
  const db = getFirestore()
  const ref = await db.collection('conversations').add({
    uid,
    title,
    lastMessage: '',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
  return ref.id
}

export async function getConversation(
  conversationId: string,
  uid: string
): Promise<ConversationDoc | null> {
  const db = getFirestore()
  const doc = await db.collection('conversations').doc(conversationId).get()
  if (!doc.exists || doc.data()?.uid !== uid) return null
  return { id: doc.id, ...doc.data() } as ConversationDoc
}

export async function listConversations(uid: string): Promise<ConversationDoc[]> {
  const db = getFirestore()
  const snap = await db
    .collection('conversations')
    .where('uid', '==', uid)
    .orderBy('updatedAt', 'desc')
    .get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ConversationDoc)
}

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  suggestions?: string[],
  clusters?: IdeaCluster[]
): Promise<void> {
  const db = getFirestore()
  const data: Record<string, unknown> = { role, content, createdAt: Timestamp.now() }
  if (suggestions && suggestions.length > 0) data.suggestions = suggestions
  if (clusters && clusters.length > 0) data.clusters = clusters
  await db
    .collection('conversations')
    .doc(conversationId)
    .collection('messages')
    .add(data)
}

export async function getMessages(conversationId: string): Promise<FirestoreMessage[]> {
  const db = getFirestore()
  const snap = await db
    .collection('conversations')
    .doc(conversationId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .get()
  return snap.docs.map((d) => {
    const data = d.data()
    const msg: FirestoreMessage = {
      role: data.role as 'user' | 'assistant',
      content: data.content as string,
      createdAt: (data.createdAt as Timestamp).toDate().toISOString(),
    }
    if (Array.isArray(data.suggestions)) msg.suggestions = data.suggestions as string[]
    if (Array.isArray(data.clusters)) msg.clusters = data.clusters as IdeaCluster[]
    return msg
  })
}

export async function updateConversationLastMessage(
  conversationId: string,
  lastMessage: string
): Promise<void> {
  const db = getFirestore()
  await db.collection('conversations').doc(conversationId).update({
    lastMessage,
    updatedAt: Timestamp.now(),
  })
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const db = getFirestore()
  const messagesSnap = await db
    .collection('conversations')
    .doc(conversationId)
    .collection('messages')
    .get()
  const batch = db.batch()
  messagesSnap.docs.forEach((d) => batch.delete(d.ref))
  batch.delete(db.collection('conversations').doc(conversationId))
  await batch.commit()
}
