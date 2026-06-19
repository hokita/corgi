import type { User } from 'firebase/auth'

interface Props {
  user: User
}

export default function ChatPage({ user }: Props) {
  return <div style={{ padding: '16px' }}>Chat — logged in as {user.email}</div>
}
