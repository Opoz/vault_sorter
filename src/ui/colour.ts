/** Colour conversions and the colours used lately, for the colour picker (issue #7). */

export interface Hsv { readonly h: number; readonly s: number; readonly v: number }

// v2: the first list also kept every shade passed while dragging through the picker.
const RECENT_KEY = 'vault-planner:recent-colours-v2'
const RECENT_MAX = 10

export function hexToHsv(hex: string): Hsv {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : 0
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const t = (k + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(t, 4 - t, 1))
  }
  return `#${[f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
}

export function readRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** Remember a colour as used lately (a per-browser convenience). */
export function rememberColour(hex: string) {
  try {
    const list = [hex.toLowerCase(), ...readRecent().filter((c) => c !== hex.toLowerCase())].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch { /* not remembered: fine */ }
  window.dispatchEvent(new Event(RECENT_EVENT))
}

/** Fired when the recent colours change, so open pickers show a colour as soon as it's used. */
export const RECENT_EVENT = 'vault-planner:recent-colours'
