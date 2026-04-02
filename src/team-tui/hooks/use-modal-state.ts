import { useState } from 'react'
import type { TuiModalState } from '../types.js'

export function useModalState() {
  const [modal, setModal] = useState<TuiModalState>({ kind: 'none' })

  return {
    modal,
    openModal(next: Exclude<TuiModalState, { kind: 'none' }>) {
      setModal(next)
    },
    closeModal() {
      setModal({ kind: 'none' })
    },
  }
}
