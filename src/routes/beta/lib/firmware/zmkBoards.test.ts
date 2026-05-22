import type { CuttleKey } from '$lib/worker/config'
import { expect, test } from 'bun:test'
import { dtsFile, type Matrix } from './firmwareHelpers'
import { assignNiceNanoPins, lemonWirelessBoard, matrixDims, NICENANO_PIN_ORDER, niceNanoKscanNode } from './zmkBoards'

const key = () => ({} as unknown as CuttleKey)

test('matrixDims returns max row+1 and max col+1', () => {
  const m: Matrix = new Map([
    [key(), [0, 0]],
    [key(), [1, 3]],
    [key(), [0, 2]],
  ])
  expect(matrixDims(m)).toEqual({ rows: 2, columns: 4 })
})

test('matrixDims of empty matrix is zero', () => {
  expect(matrixDims(new Map())).toEqual({ rows: 0, columns: 0 })
})

test('NICENANO_PIN_ORDER matches the board pro_micro nexus indices', () => {
  expect(NICENANO_PIN_ORDER).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16, 18, 19, 20, 21])
})

test('assignNiceNanoPins without trackpad: rows then cols', () => {
  expect(assignNiceNanoPins({ rows: 2, cols: 3, trackpad: false })).toEqual({
    rowPins: [0, 1],
    colPins: [2, 3, 4],
    resetPin: undefined,
    rdyPin: undefined,
  })
})

test('assignNiceNanoPins with trackpad reserves reset+rdy first', () => {
  expect(assignNiceNanoPins({ rows: 2, cols: 3, trackpad: true })).toEqual({
    resetPin: 0,
    rdyPin: 1,
    rowPins: [2, 3],
    colPins: [4, 5, 6],
  })
})

test('assignNiceNanoPins throws when not enough pins', () => {
  expect(() => assignNiceNanoPins({ rows: 10, cols: 10, trackpad: false })).toThrow()
})

test('niceNanoKscanNode ROW2COL uses active-low/pull-up and pro_micro pins', () => {
  const node = niceNanoKscanNode({ rowPins: [2, 3], colPins: [4, 5, 6] }, 'ROW2COL')
  expect(node).toEqual({
    compatible: 'zmk,kscan-gpio-matrix',
    diodeDirection: 'row2col',
    rowGpios: [
      '<&pro_micro 2 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)>',
      '<&pro_micro 3 (GPIO_ACTIVE_LOW | GPIO_PULL_UP)>',
    ],
    colGpios: [
      '<&pro_micro 4 GPIO_ACTIVE_LOW>',
      '<&pro_micro 5 GPIO_ACTIVE_LOW>',
      '<&pro_micro 6 GPIO_ACTIVE_LOW>',
    ],
  })
})

test('niceNanoKscanNode COL2ROW uses active-high/pull-down', () => {
  const node = niceNanoKscanNode({ rowPins: [0], colPins: [1] }, 'COL2ROW')
  expect(node.diodeDirection).toBe('col2row')
  expect(node.rowGpios).toEqual(['<&pro_micro 0 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>'])
  expect(node.colGpios).toEqual(['<&pro_micro 1 GPIO_ACTIVE_HIGH>'])
})

test('niceNanoKscanNode renders through dtsFile without raw gpio refs', () => {
  const out = dtsFile({ 'kscan0: kscan_0': niceNanoKscanNode({ rowPins: [2], colPins: [4] }, 'ROW2COL') })
  expect(out).toContain('compatible = "zmk,kscan-gpio-matrix"')
  expect(out).toContain('diode-direction = "row2col"')
  expect(out).toContain('&pro_micro 2')
  expect(out).not.toContain('&gpio0')
  expect(out).not.toContain('595')
})

test('lemonWirelessBoard id depends on wireless version', () => {
  expect(lemonWirelessBoard.boardId({ wirelessVersion: 'v0.3' } as any)).toBe('cosmos_lemon_wireless')
  expect(lemonWirelessBoard.boardId({ wirelessVersion: 'v0.4' } as any)).toBe('cosmos_lemon_wireless_v4')
})

test('lemonWirelessBoard keeps fixed 14x7 transform dims regardless of matrix', () => {
  expect(lemonWirelessBoard.transformDims(new Map())).toEqual({ columns: 14, rows: 7 })
})

test('lemonWirelessBoard kscan is the 595-shifter node', () => {
  const node = lemonWirelessBoard.kscanNode(new Map(), { diodeDirection: 'COL2ROW' } as any)
  expect(node.compatible).toBe('zmk,kscan-gpio-matrix')
  expect(node.colGpios).toEqual([
    '<&shifter 0 GPIO_ACTIVE_HIGH>',
    '<&shifter 1 GPIO_ACTIVE_HIGH>',
    '<&shifter 2 GPIO_ACTIVE_HIGH>',
    '<&shifter 3 GPIO_ACTIVE_HIGH>',
    '<&shifter 4 GPIO_ACTIVE_HIGH>',
    '<&shifter 5 GPIO_ACTIVE_HIGH>',
    '<&shifter 6 GPIO_ACTIVE_HIGH>',
  ])
  expect(node.rowGpios.length).toBe(7)
})
