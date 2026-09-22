// The Compass "Rose ₿" mark — the same geometry as public/icon-true-north-mark.svg
// and the mobile CompassMark, on a 0-100 grid. Anything that stamps the logo
// onto a canvas (share cards, passport) draws it from here so every surface
// renders one identical mark.

export const COMPASS_MARK = {
  orange: '#F7931A',
  orangeShade: '#D97D0C',
  ink: '#1A1714',
  inkShade: '#5E564D',
  sand: '#B7AD9D',
  medallion: '#FFFDF9',
} as const

// Official Bitcoin "B" (Wikimedia Bitcoin.svg, public domain) in its native
// 64×64 space; visual centre ≈ (32.1, 32.4). Drawn un-tilted.
export const BTC_GLYPH_PATH =
  'm46.103,27.444c0.637-4.258-2.605-6.547-7.038-8.074l1.438-5.768-3.511-0.875-1.4,5.616c-0.923-0.23-1.871-0.447-2.813-0.662l1.41-5.653-3.509-0.875-1.439,5.766c-0.764-0.174-1.514-0.346-2.242-0.527l0.004-0.018-4.842-1.209-0.934,3.75s2.605,0.597,2.55,0.634c1.422,0.355,1.679,1.296,1.636,2.042l-1.638,6.571c0.098,0.025,0.225,0.061,0.365,0.117-0.117-0.029-0.242-0.061-0.371-0.092l-2.296,9.205c-0.174,0.432-0.615,1.08-1.609,0.834,0.035,0.051-2.552-0.637-2.552-0.637l-1.743,4.019,4.569,1.139c0.85,0.213,1.683,0.436,2.503,0.646l-1.453,5.834,3.507,0.875,1.439-5.772c0.958,0.26,1.888,0.5,2.798,0.726l-1.434,5.745,3.511,0.875,1.453-5.823c5.987,1.133,10.489,0.676,12.384-4.739,1.527-4.36-0.076-6.875-3.226-8.515,2.294-0.529,4.022-2.038,4.483-5.155zm-8.022,11.249c-1.085,4.36-8.426,2.003-10.806,1.412l1.928-7.729c2.38,0.594,10.012,1.77,8.878,6.317zm1.086-11.312c-0.99,3.966-7.1,1.951-9.082,1.457l1.748-7.01c1.982,0.494,8.365,1.416,7.334,5.553z'

// Glyph transform inside the 0-100 grid: centred at (50,50), un-tilted, 0.58×.
const GLYPH_SCALE = 0.58
const GLYPH_TILT = (-14 * Math.PI) / 180
const GLYPH_CX = 32.1
const GLYPH_CY = 32.4

type Pt = [number, number]

/**
 * Stamp the Rose ₿ mark on a canvas, centred at (cx, cy) and `size` px across.
 * Long points N/E/S/W, short diagonals, one hairline ring, orange medallion
 * with the Bitcoin B. North is orange.
 */
export function drawCompassMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const k = size / 100
  const C = COMPASS_MARK

  ctx.save()
  ctx.translate(cx - 50 * k, cy - 50 * k)
  ctx.scale(k, k)

  const poly = (pts: Pt[], fill: string) => {
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }
  const ring = (r: number, alpha: number, lw: number) => {
    ctx.beginPath()
    ctx.arc(50, 50, r, 0, Math.PI * 2)
    ctx.strokeStyle = C.ink
    ctx.globalAlpha = alpha
    ctx.lineWidth = lw
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  // Draw a point at `deg` clockwise from north by rotating the canvas about the centre.
  const point = (deg: number, draw: () => void) => {
    ctx.save()
    ctx.translate(50, 50)
    ctx.rotate((deg * Math.PI) / 180)
    ctx.translate(-50, -50)
    draw()
    ctx.restore()
  }

  ring(29, 0.55, 1)

  for (const a of [45, 135, 225, 315]) {
    point(a, () => poly([[50, 12.7], [55.3, 50], [50, 52.7], [44.7, 50]], C.sand))
  }
  for (const a of [90, 180, 270]) {
    point(a, () => {
      poly([[50, 3], [57, 50], [50, 50]], C.ink)
      poly([[50, 3], [43, 50], [50, 50]], C.inkShade)
    })
  }
  poly([[50, 3], [57, 50], [50, 50]], C.orange)
  poly([[50, 3], [43, 50], [50, 50]], C.orangeShade)

  ctx.beginPath()
  ctx.arc(50, 50, 16, 0, Math.PI * 2)
  ctx.fillStyle = C.medallion
  ctx.fill()
  ctx.strokeStyle = C.orange
  ctx.lineWidth = 0.85
  ctx.stroke()

  ctx.translate(50, 50)
  ctx.rotate(GLYPH_TILT)
  ctx.scale(GLYPH_SCALE, GLYPH_SCALE)
  ctx.translate(-GLYPH_CX, -GLYPH_CY)
  ctx.fillStyle = C.orange
  ctx.fill(new Path2D(BTC_GLYPH_PATH))

  ctx.restore()
}
