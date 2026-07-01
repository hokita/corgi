import { useCallback, useRef, useState } from 'react'

export function useToast(durationMs = 4000) {
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback(
    (msg: string) => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      setToast(msg)
      toastTimer.current = setTimeout(() => setToast(null), durationMs)
    },
    [durationMs]
  )

  return { toast, showToast }
}
