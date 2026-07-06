import type { Conversation } from '../types'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark, faTrashCan } from '@fortawesome/free-solid-svg-icons'

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

export default function HistoryDrawer({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNewChat,
  onClose,
}: Props) {
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/40 z-10" />
      <div className="fixed top-0 left-0 bottom-0 w-[280px] bg-white z-[11] flex flex-col shadow-[2px_0_8px_rgba(0,0,0,0.15)]">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <span className="font-bold">Conversations</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="bg-transparent border-none text-xl cursor-pointer leading-none"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <div className="px-4 py-6 text-gray-400 text-center">No conversations yet</div>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`flex items-center px-4 py-3 border-b border-gray-100 cursor-pointer ${c.id === activeId ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                  {c.title}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{relativeTime(c.updatedAt)}</div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(c.id)
                }}
                aria-label="Delete conversation"
                className="bg-transparent border-none text-gray-300 text-base cursor-pointer p-1 ml-2 shrink-0 hover:text-red-400"
              >
                <FontAwesomeIcon icon={faTrashCan} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={onNewChat}
            className="w-full py-3 bg-[#0084ff] text-white border-none rounded-lg text-base cursor-pointer font-medium hover:bg-[#0073e6] active:bg-[#0062cc]"
          >
            + New chat
          </button>
        </div>
      </div>
    </>
  )
}
