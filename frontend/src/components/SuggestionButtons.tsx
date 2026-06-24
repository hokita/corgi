interface Props {
  items: string[]
  selectedItem?: string
  disabled: boolean
  onSelect: (item: string) => void
}

export default function SuggestionButtons({ items, selectedItem, disabled, onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-2 mt-1.5 max-w-[80%]">
      {items.map((item) => {
        const isSelected = item === selectedItem
        const isGrayed = disabled && !isSelected
        return (
          <button
            key={item}
            onClick={() => !disabled && onSelect(item)}
            disabled={disabled}
            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
              isSelected
                ? 'bg-[#0084ff] text-white border-[#0084ff] cursor-default'
                : isGrayed
                  ? 'bg-transparent text-gray-400 border-gray-300 cursor-not-allowed'
                  : 'bg-transparent text-[#0084ff] border-[#0084ff] hover:bg-blue-50 cursor-pointer'
            }`}
          >
            {item}
          </button>
        )
      })}
    </div>
  )
}
