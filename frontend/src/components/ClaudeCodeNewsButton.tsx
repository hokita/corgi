import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faNewspaper } from '@fortawesome/free-solid-svg-icons'

interface Props {
  onSend: (text: string) => void
  disabled: boolean
}

export default function ClaudeCodeNewsButton({ onSend, disabled }: Props) {
  return (
    <button
      onClick={() => !disabled && onSend("What's new from Anthropic and Claude Code?")}
      disabled={disabled}
      className="px-4 py-2 rounded-full text-sm border border-[#0084ff] text-[#0084ff] bg-transparent hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
    >
      <FontAwesomeIcon icon={faNewspaper} className="mr-1" /> Claude Code News
    </button>
  )
}
