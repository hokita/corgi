import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { EnglishMistakeData, EnglishMistakeDoc, GetMistakesParams } from '../models/api'

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
  suggestions?: string[]
): Promise<void> {
  const db = getFirestore()
  const data: Record<string, unknown> = { role, content, createdAt: Timestamp.now() }
  if (suggestions && suggestions.length > 0) data.suggestions = suggestions
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

export async function listEnglishMistakes(
  uid: string,
  params: GetMistakesParams
): Promise<EnglishMistakeDoc[]> {
  const db = getFirestore()
  let query = db
    .collection('english_mistakes')
    .where('uid', '==', uid)
    .orderBy('createdAt', 'desc') as FirebaseFirestore.Query

  if (params.startDate) {
    query = query.where('createdAt', '>=', Timestamp.fromDate(new Date(params.startDate)))
  }
  if (params.endDate) {
    const end = new Date(params.endDate)
    end.setDate(end.getDate() + 1)
    query = query.where('createdAt', '<', Timestamp.fromDate(end))
  }

  const snap = await query.limit(params.limit ?? 50).get()
  let docs = snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      uid: data.uid as string,
      conversationId: data.conversationId as string,
      originalText: data.originalText as string,
      correctedText: data.correctedText as string,
      category: data.category as string,
      severity: data.severity as string,
      patternKey: data.patternKey as string,
      createdAt: (data.createdAt as Timestamp).toDate().toISOString(),
    } as EnglishMistakeDoc
  })

  if (params.category) {
    docs = docs.filter((d) => d.category === params.category)
  }

  return docs
}

export async function saveEnglishMistake(
  uid: string,
  conversationId: string,
  data: EnglishMistakeData
): Promise<void> {
  const db = getFirestore()
  await db.collection('english_mistakes').add({
    uid,
    conversationId,
    ...data,
    createdAt: Timestamp.now(),
  })
}
