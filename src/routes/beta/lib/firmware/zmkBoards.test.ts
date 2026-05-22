import type { CuttleKey } from '$lib/worker/config'
import { expect, test } from 'bun:test'
import { dtsFile, type Matrix } from './firmwareHelpers'
import { generateAzoteqOverlay, generateConf, generateDTSI, generateOverlay } from './zmk'
import { assignNiceNanoPins, lemonWirelessBoard, matrixDims, NICENANO_PIN_ORDER, niceNanoBoard, niceNanoKscanNode, sideColumnSpan } from './zmkBoards'

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

test('assignNiceNanoPins with trackpad reserves reset+rdy and excludes I2C pins 2,3', () => {
  // Pins 2 (SDA) and 3 (SCL) are removed; reset/rdy take 0,1; rows/cols continue from 4.
  expect(assignNiceNanoPins({ rows: 2, cols: 3, trackpad: true })).toEqual({
    resetPin: 0,
    rdyPin: 1,
    rowPins: [4, 5],
    colPins: [6, 7, 8],
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
  const node = lemonWirelessBoard.kscanNode({ rows: 7, columns: 14 }, { diodeDirection: 'COL2ROW' } as any)
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

test('niceNanoBoard uses upstream nice_nano_v2', () => {
  expect(niceNanoBoard.boardId({} as any)).toBe('nice_nano_v2')
})

test('niceNanoBoard derives transform dims from the matrix', () => {
  const m: Matrix = new Map([[key(), [0, 0]], [key(), [2, 5]]])
  expect(niceNanoBoard.transformDims(m)).toEqual({ rows: 3, columns: 6 })
})

test('niceNanoBoard kscan reflects diode direction and trackpad reservation', () => {
  const node = niceNanoBoard.kscanNode({ rows: 1, columns: 1 }, { diodeDirection: 'COL2ROW', peripherals: { unibody: { azoteq: false } } } as any)
  expect(node.rowGpios).toEqual(['<&pro_micro 0 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>'])
  expect(node.colGpios).toEqual(['<&pro_micro 1 GPIO_ACTIVE_HIGH>'])
})

test('sideColumnSpan: left starts at 0 → span equals column count', () => {
  const a = key(), b = key()
  const m: Matrix = new Map([[a, [0, 0]], [b, [0, 3]]])
  expect(sideColumnSpan(m, [a, b])).toBe(4)
})

test('sideColumnSpan: globally-numbered right half spans its own width', () => {
  const a = key(), b = key()
  const m: Matrix = new Map([[a, [0, 7]], [b, [0, 13]]])
  expect(sideColumnSpan(m, [a, b])).toBe(7) // cols 7..13
})

test('sideColumnSpan of keys not in the matrix is 0', () => {
  expect(sideColumnSpan(new Map(), [key()])).toBe(0)
})

const dtsiOpts = {
  board: 'lemon-wireless',
  diodeDirection: 'COL2ROW',
  folderName: 'kb',
  underGlowAtStart: true,
  wirelessVersion: 'v0.3',
  peripherals: { left: { azoteq: false }, right: { azoteq: false }, unibody: { azoteq: false } },
} as any
const dtsiGeo = { left: { c: { keys: [] } }, right: { c: { keys: [] } } } as any
const dtsiMatrix: Matrix = new Map([[key(), [0, 0]], [key(), [6, 13]]])

test('Lemon DTSI keeps shifter cols and 14x7 transform', () => {
  const out = generateDTSI(dtsiGeo, dtsiMatrix, dtsiOpts)
  expect(out).toContain('zmk,gpio-595')
  expect(out).toContain('columns = <14>')
  expect(out).toContain('rows = <7>')
})

test('nice!nano DTSI emits pro_micro matrix, no shifter', () => {
  // Use a small matrix (2 rows x 3 cols = 5 pins) that fits within nice!nano's 18 available pins
  const smallMatrix: Matrix = new Map([[key(), [0, 0]], [key(), [1, 2]]])
  const out = generateDTSI(dtsiGeo, smallMatrix, { ...dtsiOpts, board: 'nicenano', diodeDirection: 'ROW2COL' })
  expect(out).toContain('&pro_micro')
  expect(out).toContain('diode-direction = "row2col"')
  expect(out).not.toContain('zmk,gpio-595')
  expect(out).toContain('columns = <3>') // matrix max col 2 + 1
  expect(out).toContain('rows = <2>') // matrix max row 1 + 1
})

test('nice!nano split kscan wires per-half columns, transform stays global', () => {
  const sk = () => ({ type: 'mx-better' } as unknown as CuttleKey) // valid socket type so encoderKeys() works
  const L0 = sk(), L1 = sk(), R0 = sk(), R1 = sk()
  // 2 columns per half; right half numbered globally (2,3) → 4 columns total
  const splitMatrix: Matrix = new Map([[L0, [0, 0]], [L1, [0, 1]], [R0, [0, 2]], [R1, [0, 3]]])
  const splitGeo = { left: { c: { keys: [L0, L1] } }, right: { c: { keys: [R0, R1] } } } as any
  const out = generateDTSI(splitGeo, splitMatrix, { ...dtsiOpts, board: 'nicenano', diodeDirection: 'ROW2COL' })
  // Transform spans the full keyboard...
  expect(out).toContain('columns = <4>')
  // ...but each nice!nano's kscan wires only its own 2 columns (col-gpios, not row-gpios).
  const colGpios = (out.match(/&pro_micro \d+ GPIO_ACTIVE_LOW>/g) || []).length
  expect(colGpios).toBe(2)
})

test('Lemon right overlay keeps fixed col-offset 7', () => {
  const out = generateOverlay(dtsiGeo, dtsiMatrix, dtsiOpts, 'right')
  expect(out).toContain('col-offset = <7>')
})

test('nice!nano right overlay col-offset equals the left half column count', () => {
  const sk = () => ({ type: 'mx-better' } as unknown as CuttleKey)
  const L0 = sk(), L1 = sk(), R0 = sk()
  // Left occupies columns 0,1 (count 2) → right shield col-offset must be 2.
  const m: Matrix = new Map([[L0, [0, 0]], [L1, [0, 1]], [R0, [0, 2]]])
  const geo = { left: { c: { keys: [L0, L1] } }, right: { c: { keys: [R0] } } } as any
  const out = generateOverlay(geo, m, { ...dtsiOpts, board: 'nicenano' }, 'right')
  expect(out).toContain('col-offset = <2>')
})

test('nice!nano conf enables Azoteq pointing when a trackpad is present', () => {
  const opts = { board: 'nicenano', peripherals: { unibody: { azoteq: true } } } as any
  const conf = generateConf({ unibody: { c: { keys: [] } } } as any, opts)
  expect(conf).toContain('CONFIG_INPUT_AZOTEQ_IQS5XX=y')
  expect(conf).toContain('CONFIG_ZMK_POINTING=y')
  expect(conf).toContain('CONFIG_I2C=y')
})

test('nice!nano conf omits Azoteq flags without a trackpad', () => {
  const opts = { board: 'nicenano', peripherals: { unibody: { azoteq: false } } } as any
  expect(generateConf({ unibody: { c: { keys: [] } } } as any, opts)).not.toContain('AZOTEQ')
})

test('Azoteq overlay binds iqs5xx@74 on pro_micro_i2c with reset/rdy on pro_micro', () => {
  const m: Matrix = new Map([[key(), [0, 0]]])
  const out = dtsFile(generateAzoteqOverlay(m) as any)
  expect(out).toContain('azoteq,iqs5xx')
  expect(out).toContain('pro_micro_i2c')
  expect(out).toContain('reset-gpios = <&pro_micro 0 GPIO_ACTIVE_LOW>')
  expect(out).toContain('rdy-gpios = <&pro_micro 1 GPIO_ACTIVE_HIGH>')
  expect(out).toContain('input-listener')
})
