import type { Conversation } from '../types'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onNewChat: () => void
  onClose: () => void
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function HistoryDrawer({ conversations, activeId, onSelect, onDelete, onNewChat, onClose }: Props) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}
      />
      <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: '280px', background: '#fff', zIndex: 11, display: 'flex', flexDirection: 'column', boxShadow: '2px 0 8px rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', borderBottom: '1px solid #e0e0e0' }}>
          <span style={{ fontWeight: 'bold' }}>Conversations</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {conversations.length === 0 && (
            <div style={{ padding: '24px 16px', color: '#999', textAlign: 'center' }}>No conversations yet</div>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f0f0f0', background: c.id === activeId ? '#f0f7ff' : 'transparent', cursor: 'pointer' }}
              onClick={() => onSelect(c.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>{relativeTime(c.updatedAt)}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}
                style={{ background: 'none', border: 'none', color: '#ccc', fontSize: '16px', cursor: 'pointer', padding: '4px', marginLeft: '8px', flexShrink: 0 }}
              >
                🗑
              </button>
            </div>
          ))}
        </div>

        <div style={{ padding: '16px', borderTop: '1px solid #e0e0e0' }}>
          <button
            onClick={onNewChat}
            style={{ width: '100%', padding: '12px', background: '#0084ff', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', cursor: 'pointer', fontWeight: 500 }}
          >
            + New chat
          </button>
        </div>
      </div>
    </>
  )
}
