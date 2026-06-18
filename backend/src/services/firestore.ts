import { getFirestore, Timestamp } from 'firebase-admin/firestore'

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
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ConversationDoc))
}

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const db = getFirestore()
  await db
    .collection('conversations')
    .doc(conversationId)
    .collection('messages')
    .add({ role, content, createdAt: Timestamp.now() })
}

export async function getMessages(conversationId: string): Promise<FirestoreMessage[]> {
  const db = getFirestore()
  const snap = await db
    .collection('conversations')
    .doc(conversationId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .get()
  return snap.docs.map((d) => ({
    role: d.data().role as 'user' | 'assistant',
    content: d.data().content as string,
    createdAt: (d.data().createdAt as Timestamp).toDate().toISOString(),
  }))
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
