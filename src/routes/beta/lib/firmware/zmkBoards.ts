import type { Matrix } from './firmwareHelpers'
import type { ZMKOptions } from './zmk'

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

export function niceNanoKscanNode(pins: { rowPins: number[]; colPins: number[] }, diode: DiodeDirection): { compatible: string; diodeDirection: string; rowGpios: string[]; colGpios: string[] } {
  const activeMode = diode == 'COL2ROW' ? 'GPIO_ACTIVE_HIGH' : 'GPIO_ACTIVE_LOW'
  const pullMode = diode == 'COL2ROW' ? 'GPIO_PULL_DOWN' : 'GPIO_PULL_UP'
  return {
    compatible: 'zmk,kscan-gpio-matrix',
    diodeDirection: diode.toLowerCase(),
    rowGpios: pins.rowPins.map(p => `<&pro_micro ${p} (${activeMode} | ${pullMode})>`),
    colGpios: pins.colPins.map(p => `<&pro_micro ${p} ${activeMode}>`),
  }
}

export interface ZMKBoard {
  boardId(options: ZMKOptions): string
  transformDims(matrix: Matrix): { columns: number; rows: number }
  /** The kscan0 node object passed to dtsFile. */
  kscanNode(matrix: Matrix, options: ZMKOptions): { compatible: string; diodeDirection: string; rowGpios: string[]; colGpios: string[] }
}

export const lemonWirelessBoard: ZMKBoard = {
  boardId: (o) => o.wirelessVersion == 'v0.4' ? 'cosmos_lemon_wireless_v4' : 'cosmos_lemon_wireless',
  transformDims: () => ({ columns: 14, rows: 7 }),
  kscanNode: (_matrix, options) => {
    const activeMode = options.diodeDirection == 'COL2ROW' ? 'GPIO_ACTIVE_HIGH' : 'GPIO_ACTIVE_LOW'
    const pullMode = options.diodeDirection == 'COL2ROW' ? 'GPIO_PULL_DOWN' : 'GPIO_PULL_UP'
    return {
      compatible: 'zmk,kscan-gpio-matrix',
      diodeDirection: 'col2row',
      rowGpios: [
        `<&gpio0 20 (${activeMode} | ${pullMode})>`,
        `<&gpio0 22 (${activeMode} | ${pullMode})>`,
        `<&gpio0 24 (${activeMode} | ${pullMode})>`,
        `<&gpio0 9  (${activeMode} | ${pullMode})>`,
        `<&gpio0 10 (${activeMode} | ${pullMode})>`,
        `<&gpio1 13 (${activeMode} | ${pullMode})>`,
        `<&gpio1 15 (${activeMode} | ${pullMode})>`,
      ],
      colGpios: [
        '<&shifter 0 GPIO_ACTIVE_HIGH>',
        '<&shifter 1 GPIO_ACTIVE_HIGH>',
        '<&shifter 2 GPIO_ACTIVE_HIGH>',
        '<&shifter 3 GPIO_ACTIVE_HIGH>',
        '<&shifter 4 GPIO_ACTIVE_HIGH>',
        '<&shifter 5 GPIO_ACTIVE_HIGH>',
        '<&shifter 6 GPIO_ACTIVE_HIGH>',
      ],
    }
  },
}
