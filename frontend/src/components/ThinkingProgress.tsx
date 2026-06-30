interface Props {
  step: string
}

export default function ThinkingProgress({ step }: Props) {
  return (
    <div className="text-xs text-gray-400 mb-1 px-1">
      <span>{step}</span>
    </div>
  )
}
