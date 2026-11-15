import { create } from 'zustand'

type ConfirmOptions = {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type ConfirmState = {
  open: boolean
  options: ConfirmOptions
  resolve: ((value: boolean) => void) | null
  ask: (options: ConfirmOptions) => Promise<boolean>
  settle: (value: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: { title: '' },
  resolve: null,
  ask: options => new Promise<boolean>(resolve => {
    set({ open: true, options, resolve })
  }),
  settle: value => {
    const resolve = get().resolve
    set({ open: false, resolve: null })
    resolve?.(value)
  },
}))

export function confirmAction(options: ConfirmOptions) {
  return useConfirmStore.getState().ask(options)
}
