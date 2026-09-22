'use client'

import { useRef, type MouseEvent, type PointerEvent } from 'react'

/**
 * Click-the-backdrop-to-dismiss that survives a drag.
 *
 * A plain onClick on the backdrop also fires when a drag starts inside the
 * modal (selecting text in an input, dragging a textarea resize handle) and
 * the mouse is released over the backdrop — the browser dispatches `click`
 * on the nearest common ancestor, which is the backdrop itself, so
 * stopPropagation on the panel can't catch it. Only dismiss when the press
 * *and* the release both landed on the backdrop.
 *
 * Spread the result onto the backdrop element:
 *   <div {...useBackdropDismiss(() => setOpen(false))} />
 */
export function useBackdropDismiss(onDismiss: () => void) {
  const pressedOnBackdrop = useRef(false)

  return {
    onPointerDown(e: PointerEvent) {
      pressedOnBackdrop.current = e.target === e.currentTarget
    },
    onClick(e: MouseEvent) {
      if (!pressedOnBackdrop.current || e.target !== e.currentTarget) return
      pressedOnBackdrop.current = false
      onDismiss()
    },
  }
}
