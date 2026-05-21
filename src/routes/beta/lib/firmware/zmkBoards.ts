import type { Matrix } from './firmwareHelpers'

export function matrixDims(matrix: Matrix): { rows: number; columns: number } {
  let rows = 0
  let columns = 0
  for (const [r, c] of matrix.values()) {
    rows = Math.max(rows, r + 1)
    columns = Math.max(columns, c + 1)
  }
  return { rows, columns }
}

export const NICENANO_PIN_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16, 18, 19, 20, 21]

export interface NiceNanoPins {
  rowPins: number[]
  colPins: number[]
  resetPin?: number
  rdyPin?: number
}

export function assignNiceNanoPins(
  { rows, cols, trackpad }: { rows: number; cols: number; trackpad: boolean },
): NiceNanoPins {
  const pool = [...NICENANO_PIN_ORDER]
  const take = (n: number) => {
    if (pool.length < n) throw new Error(`Not enough nice!nano GPIO pins: need ${n} more, ${pool.length} left`)
    return pool.splice(0, n)
  }
  let resetPin: number | undefined
  let rdyPin: number | undefined
  if (trackpad) [resetPin, rdyPin] = take(2)
  const rowPins = take(rows)
  const colPins = take(cols)
  return { rowPins, colPins, resetPin, rdyPin }
}

type DiodeDirection = 'COL2ROW' | 'ROW2COL'

export function niceNanoKscanNode(pins: { rowPins: number[]; colPins: number[] }, diode: DiodeDirection) {
  const activeMode = diode == 'COL2ROW' ? 'GPIO_ACTIVE_HIGH' : 'GPIO_ACTIVE_LOW'
  const pullMode = diode == 'COL2ROW' ? 'GPIO_PULL_DOWN' : 'GPIO_PULL_UP'
  return {
    compatible: 'zmk,kscan-gpio-matrix',
    diodeDirection: diode.toLowerCase(),
    rowGpios: pins.rowPins.map(p => `<&pro_micro ${p} (${activeMode} | ${pullMode})>`),
    colGpios: pins.colPins.map(p => `<&pro_micro ${p} ${activeMode}>`),
  }
}
