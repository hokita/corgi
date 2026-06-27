interface Props {
  steps: string[]
}

export default function ThinkingProgress({ steps }: Props) {
  if (steps.length === 0) return null
  return (
    <div className="text-xs text-gray-400 flex flex-col gap-0.5 mb-1 px-1">
      {steps.map((step, i) => (
        <span key={i}>{step}</span>
      ))}
    </div>
  )
}
