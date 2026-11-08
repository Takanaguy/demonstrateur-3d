import { parseHexColor } from './color'

describe('parseHexColor', () => {
  it('convertit #RRGGBB en trois canaux entre 0 et 1', () => {
    const [r, g, b] = parseHexColor('#2E5D7C')
    expect(r).toBeCloseTo(46 / 255)
    expect(g).toBeCloseTo(93 / 255)
    expect(b).toBeCloseTo(124 / 255)
  })

  it('donne exactement 0 et 1 pour noir et blanc, sans tenir compte de la casse', () => {
    expect(parseHexColor('#000000')).toEqual([0, 0, 0])
    expect(parseHexColor('#ffffff')).toEqual([1, 1, 1])
    expect(parseHexColor('#FFffFF')).toEqual([1, 1, 1])
  })

  it.each(['2E5D7C', '#2E5D7', '#2E5D7C0', '#GGGGGG', '', '#fff'])('refuse « %s »', (bad) => {
    expect(() => parseHexColor(bad)).toThrow(RangeError)
  })
})
