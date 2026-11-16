import { describe, expect, it } from 'vitest'
import { hexToHsv, hsvToHex } from './colour'

describe('colour conversions', () => {
  it('turns hex into hue, saturation and brightness and back', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#d3d5d2', '#2f3236', '#000000', '#ffffff', '#c0392b']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex)
    }
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
  })
})
