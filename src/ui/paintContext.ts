/**
 * Painting, shared with the 2D drawing's Units (issue #7): whether a click paints, a part's painted colour, and the
 * Depth each Tower is drawn at (to tell which part each drawn piece is).
 */
import { createContext, useContext } from 'react'
import type { Depth } from '../engine/model'
import type { PaintTarget } from '../editor/paint'

export interface PaintContextValue {
  readonly painting: boolean
  readonly colourOf: (towerId: string, target: PaintTarget) => string | undefined
  readonly onPaint: (towerId: string, target: PaintTarget) => void
  readonly depthOf: (towerId: string) => Depth | undefined
}

export const PaintContext = createContext<PaintContextValue | null>(null)

export const usePaint = () => useContext(PaintContext)
