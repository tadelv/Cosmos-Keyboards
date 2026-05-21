# nice!nano ZMK Firmware Autogen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate buildable ZMK firmware for bare nice!nano / nRFMicro (nRF52840) keyboards — split and unibody, with auto-assigned matrix pins and an Azoteq IQS5xx trackpad — alongside the existing Cosmos Lemon Wireless support.

**Architecture:** Introduce a `ZMKBoard` profile that captures everything board-specific (board id, kscan node, transform dims, column offset, conf lines, west/deps projects). Refactor the existing Lemon behavior into a `lemonWireless` profile that returns its current fixed values verbatim (so Lemon output stays byte-identical), and add a `niceNano` profile with a direct-GPIO matrix kscan, pure pin-assignment, and an Azoteq overlay. `downloadZMKCode` selects the profile from a new `options.board` field. The keymap/layout/keycode/transform-map logic in `zmk.ts` stays shared.

**Tech Stack:** TypeScript, SvelteKit, `bun:test`, ZMK devicetree (DTS/YAML) generated via the existing `dtsFile`/`yamlFile` helpers in `firmwareHelpers.ts`.

**Spec:** `docs/superpowers/specs/2026-05-21-nicenano-zmk-autogen-design.md`

---

## File Structure

- **Create** `src/routes/beta/lib/firmware/zmkBoards.ts` — `ZMKBoard` interface, `lemonWirelessBoard`, `niceNanoBoard`, and pure helpers (`matrixDims`, `assignNiceNanoPins`, `niceNanoKscanNode`, `NICENANO_PIN_ORDER`).
- **Create** `src/routes/beta/lib/firmware/zmkBoards.test.ts` — unit tests for the pure helpers + profile values.
- **Modify** `src/routes/beta/lib/firmware/zmk.ts` — add `board` to `ZMKOptions`, `azoteq` to `ZMKPeripherals`; delegate board-specific generation to the profile; add Azoteq overlay generation; export the pieces the tests need.
- **Modify** `src/routes/beta/lib/editor/PeaConfig.svelte` — add the nice!nano firmware UI block, peripheral detection for `trackpad-azoteq`, and a central-side-trackpad check.

> Convention confirmed from Lemon (`columns=14`, right `col-offset=7`, transform map built from raw `matrix.values()`): **split column indices are entered global** (right side starts at left's column count). The `niceNano` profile derives dims with `matrixDims` and uses the left column count as the right `col-offset`. The `lemonWireless` profile keeps the fixed `14/7` and `7` so its output never changes.

---

## Task 1: Pure helper — `matrixDims`

**Files:**
- Create: `src/routes/beta/lib/firmware/zmkBoards.ts`
- Test: `src/routes/beta/lib/firmware/zmkBoards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/routes/beta/lib/firmware/zmkBoards.test.ts
import { expect, test } from 'bun:test'
import type { CuttleKey } from '$lib/worker/config'
import type { Matrix } from './firmwareHelpers'
import { matrixDims } from './zmkBoards'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: FAIL — `Cannot find module './zmkBoards'` / `matrixDims is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/routes/beta/lib/firmware/zmkBoards.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/beta/lib/firmware/zmkBoards.ts src/routes/beta/lib/firmware/zmkBoards.test.ts
git commit -m "feat(zmk): add matrixDims helper for generic transform sizing"
```

---

## Task 2: Pure helper — `NICENANO_PIN_ORDER` + `assignNiceNanoPins`

Auto pin assignment. With a trackpad, reset+rdy take the first two pool pins (I2C SDA/SCL are board-default pins, not from the pool). Then rows, then columns.

**Files:**
- Modify: `src/routes/beta/lib/firmware/zmkBoards.ts`
- Test: `src/routes/beta/lib/firmware/zmkBoards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { assignNiceNanoPins, NICENANO_PIN_ORDER } from './zmkBoards'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: FAIL — `assignNiceNanoPins is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to zmkBoards.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/routes/beta/lib/firmware/zmkBoards.ts src/routes/beta/lib/firmware/zmkBoards.test.ts
git commit -m "feat(zmk): add nice!nano auto pin assignment"
```

---

## Task 3: Pure helper — `niceNanoKscanNode`

Builds the `zmk,kscan-gpio-matrix` node object (consumed by `dtsFile`). Uses the `&pro_micro` nexus and sets `diode-direction` **from options** (fixing the Lemon hardcode for the new path). Active/pull modes follow the existing `generateDTSI` logic: COL2ROW → ACTIVE_HIGH/PULL_DOWN, ROW2COL → ACTIVE_LOW/PULL_UP.

**Files:**
- Modify: `src/routes/beta/lib/firmware/zmkBoards.ts`
- Test: `src/routes/beta/lib/firmware/zmkBoards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { niceNanoKscanNode } from './zmkBoards'
import { dtsFile } from './firmwareHelpers'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: FAIL — `niceNanoKscanNode is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to zmkBoards.ts
import type { NiceNanoPins } from './zmkBoards' // (same file; for reference)

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
```

(Remove the bogus self-import line if your editor adds it; `NiceNanoPins` is already in this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/routes/beta/lib/firmware/zmkBoards.ts src/routes/beta/lib/firmware/zmkBoards.test.ts
git commit -m "feat(zmk): add nice!nano kscan-gpio-matrix node builder"
```

---

## Task 4: `ZMKBoard` interface + `lemonWirelessBoard` (regression-locked)

Define the profile interface and the Lemon implementation that returns the **current fixed values** so existing output is unchanged. The Lemon kscan node and dims are copied verbatim from `zmk.ts` `generateDTSI` (lines ~378-405) and the firmware test fixture (`firmwareHelpers.test.ts:32-58`).

**Files:**
- Modify: `src/routes/beta/lib/firmware/zmkBoards.ts`
- Test: `src/routes/beta/lib/firmware/zmkBoards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { lemonWirelessBoard } from './zmkBoards'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: FAIL — `lemonWirelessBoard` undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to zmkBoards.ts
import type { ZMKOptions } from './zmk'

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
```

> Note: the Lemon `kscanNode` keeps the literal `diodeDirection: 'col2row'` exactly as the current code does — do **not** "fix" it here, to keep Lemon output byte-identical. The diode-direction fix applies only to nice!nano.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/routes/beta/lib/firmware/zmkBoards.ts src/routes/beta/lib/firmware/zmkBoards.test.ts
git commit -m "feat(zmk): add ZMKBoard interface and lemonWireless profile"
```

---

## Task 5: `niceNanoBoard` profile

Implements the interface for nice!nano: upstream board id, derived dims, derived right offset, and the direct-GPIO kscan from Tasks 2-3. Column offset = left side's column count; for the shared transform this equals the smallest column index used by the right side (global numbering), which `matrixDims` of the left side gives.

**Files:**
- Modify: `src/routes/beta/lib/firmware/zmkBoards.ts`
- Test: `src/routes/beta/lib/firmware/zmkBoards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { niceNanoBoard } from './zmkBoards'

test('niceNanoBoard uses upstream nice_nano_v2', () => {
  expect(niceNanoBoard.boardId({} as any)).toBe('nice_nano_v2')
})

test('niceNanoBoard derives transform dims from the matrix', () => {
  const m: Matrix = new Map([[key(), [0, 0]], [key(), [2, 5]]])
  expect(niceNanoBoard.transformDims(m)).toEqual({ rows: 3, columns: 6 })
})

test('niceNanoBoard kscan reflects diode direction and trackpad reservation', () => {
  // 1 row, 1 col, no trackpad → rows take pin 0, cols take pin 1
  const m: Matrix = new Map([[key(), [0, 0]]])
  const node = niceNanoBoard.kscanNode(m, { diodeDirection: 'COL2ROW', peripherals: { unibody: { azoteq: false } } } as any)
  expect(node.rowGpios).toEqual(['<&pro_micro 0 (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>'])
  expect(node.colGpios).toEqual(['<&pro_micro 1 GPIO_ACTIVE_HIGH>'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: FAIL — `niceNanoBoard` undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to zmkBoards.ts
function anyAzoteq(options: ZMKOptions): boolean {
  return Object.values(options.peripherals).some((p: any) => p.azoteq)
}

export const niceNanoBoard: ZMKBoard = {
  boardId: () => 'nice_nano_v2',
  transformDims: (matrix) => matrixDims(matrix),
  kscanNode: (matrix, options) => {
    const { rows, columns } = matrixDims(matrix)
    const pins = assignNiceNanoPins({ rows, cols: columns, trackpad: anyAzoteq(options) })
    return niceNanoKscanNode(pins, options.diodeDirection)
  },
}
```

> The right-side `col-offset` is **not** a profile method — it's computed in `generateOverlay` (Task 8) where per-side key membership is known (Lemon → literal `7`; nice!nano → left column count).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: PASS (16 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/routes/beta/lib/firmware/zmkBoards.ts src/routes/beta/lib/firmware/zmkBoards.test.ts
git commit -m "feat(zmk): add niceNano board profile"
```

---

## Task 6: Add `board` to `ZMKOptions` and `azoteq` to `ZMKPeripherals`

**Files:**
- Modify: `src/routes/beta/lib/firmware/zmk.ts:11-34`

- [ ] **Step 1: Edit the interfaces**

In `zmk.ts`, change `ZMKPeripherals` and `ZMKOptions`:

```ts
interface ZMKPeripherals {
  pmw3610: boolean
  cirque: boolean
  azoteq: boolean
  encoder: boolean
}

export interface ZMKOptions {
  vid: string
  pid: string
  keyboardName: string
  folderName: string
  yourName: string
  diodeDirection: 'COL2ROW' | 'ROW2COL'
  centralSide: 'left' | 'right'
  board: 'lemon-wireless' | 'nicenano'
  peripherals: {
    left: ZMKPeripherals
    right: ZMKPeripherals
    unibody: ZMKPeripherals
  }
  underGlowAtStart: boolean
  enableConsole: boolean
  enableStudio: boolean
  wirelessVersion: 'v0.3' | 'v0.4'
}
```

- [ ] **Step 2: Add the profile selector**

Near the top of `zmk.ts`, after imports, add:

```ts
import { lemonWirelessBoard, niceNanoBoard, type ZMKBoard } from './zmkBoards'

function boardProfile(options: ZMKOptions): ZMKBoard {
  return options.board == 'nicenano' ? niceNanoBoard : lemonWirelessBoard
}
```

- [ ] **Step 3: Replace `boardName` with the profile**

Delete the `boardName` function (`zmk.ts:154-158`) and replace its call sites in `generateBuildYaml` (`board: boardName(options)` → `board: boardProfile(options).boardId(options)`).

- [ ] **Step 4: Type-check**

Run: `npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E 'zmk|PeaConfig' | head`
Expected: errors only in `PeaConfig.svelte` (missing `board` in the stored options) — fixed in Task 9. No errors in `zmk.ts`/`zmkBoards.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/beta/lib/firmware/zmk.ts
git commit -m "feat(zmk): add board + azoteq fields and profile selector"
```

---

## Task 7: Delegate `generateDTSI` kscan + transform dims to the profile

Replace the hardcoded kscan node and `columns: 14, rows: 7` in `generateDTSI` (`zmk.ts:343-438`) with profile calls. Keep the encoder/sensor/ext-power-hog logic and the VIK `&spi1` block **only for Lemon**.

**Files:**
- Modify: `src/routes/beta/lib/firmware/zmk.ts:343-438`

- [ ] **Step 1: Edit `generateDTSI`**

Replace the `default_transform` dims and the `kscan0` node literal with:

```ts
const board = boardProfile(options)
const dims = board.transformDims(matrix)
// ...inside the '/' object:
'default_transform: keymap_transform_0': {
  compatible: 'zmk,matrix-transform',
  columns: dims.columns,
  rows: dims.rows,
  map: '<' + Array.from(matrix.values()).map(([r, c]) => `RC(${r},${c})`).join(' ') + '>',
},
'kscan0: kscan_0': board.kscanNode(matrix, options),
```

Wrap the Lemon-only `&spi1` shifter block and the `ext_power_hog` block so they are emitted **only when** `options.board == 'lemon-wireless'`. The simplest approach: build the DTS object conditionally, e.g.

```ts
const isLemon = options.board == 'lemon-wireless'
return dtsFile({
  [raw()]: '#include <behaviors.dtsi>',
  [raw()]: '#include <dt-bindings/zmk/matrix_transform.h>',
  [raw()]: '#include <dt-bindings/zmk/keys.h>',
  [raw()]: `#include "${options.folderName}-layouts.dtsi"`,
  ...(isLemon ? lemonSpiPreamble() : {}),   // extract the VIK #defines + &spi1 block into a helper
  '/': { /* chosen, default_transform (dims), kscan0 (profile), encoders, sensors */ },
  ...(isLemon && !options.underGlowAtStart ? lemonExtPowerHog() : {}),
})
```

Extract the Lemon `&spi1` preamble (`zmk.ts:354-371`) into a local `lemonSpiPreamble()` and the ext-power-hog block (`zmk.ts:425-436`) into `lemonExtPowerHog()` to keep `generateDTSI` readable. The `chosen` node keeps `'zmk,physical-layout': '&default_layout'` for both boards.

- [ ] **Step 2: Add a regression test for the Lemon DTSI shape**

In `zmkBoards.test.ts` (or a new `zmk.test.ts`), export `generateDTSI` from `zmk.ts` and assert Lemon still emits the shifter + 14/7 dims. Minimal `FullGeometry` stub (only `.c.keys` is read, for encoders):

```ts
// in zmk.ts, add: export { generateDTSI }
import { generateDTSI } from './zmk'

const lemonOpts = { board: 'lemon-wireless', diodeDirection: 'COL2ROW', folderName: 'kb',
  underGlowAtStart: true, peripherals: { left: {}, right: {} } } as any
const geo = { left: { c: { keys: [] } }, right: { c: { keys: [] } } } as any
const m: Matrix = new Map([[key(), [0, 0]], [key(), [6, 13]]])

test('Lemon DTSI keeps shifter cols and 14x7 transform', () => {
  const out = generateDTSI(geo, m, lemonOpts)
  expect(out).toContain('zmk,gpio-595')
  expect(out).toContain('columns = <14>')
  expect(out).toContain('rows = <7>')
})

test('nice!nano DTSI emits pro_micro matrix, no shifter', () => {
  const out = generateDTSI(geo, m, { ...lemonOpts, board: 'nicenano', diodeDirection: 'ROW2COL' })
  expect(out).toContain('&pro_micro')
  expect(out).toContain('diode-direction = "row2col"')
  expect(out).not.toContain('zmk,gpio-595')
  expect(out).toContain('columns = <14>') // matrix max col 13 + 1
})
```

- [ ] **Step 3: Run tests**

Run: `npx bun test src/routes/beta/lib/firmware/`
Expected: PASS, including the existing `firmwareHelpers.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/beta/lib/firmware/zmk.ts src/routes/beta/lib/firmware/zmkBoards.test.ts
git commit -m "feat(zmk): delegate kscan and transform dims to board profile"
```

---

## Task 8: Right-side column offset from per-side counts

`generateOverlay` (`zmk.ts:483-514`) hardcodes the right `colOffset: 7`. Make it the left side's column count for nice!nano, while Lemon keeps 7.

**Files:**
- Modify: `src/routes/beta/lib/firmware/zmk.ts:483-514`
- Test: `src/routes/beta/lib/firmware/zmkBoards.test.ts`

- [ ] **Step 1: Add a per-side column-count helper + test**

In `zmkBoards.ts`:

```ts
import { hasPinsInMatrix } from '$lib/loaders/keycaps'

/** Number of distinct columns used by a set of keys' matrix entries. */
export function sideColumnCount(matrix: Matrix, sideKeys: ReadonlyArray<unknown>): number {
  let max = -1
  for (const [k, [, c]] of matrix.entries()) {
    if (sideKeys.includes(k as any)) max = Math.max(max, c)
  }
  return max + 1
}
```

Test:

```ts
import { sideColumnCount } from './zmkBoards'

test('sideColumnCount counts columns for the given keys', () => {
  const a = key(), b = key(), c = key()
  const m: Matrix = new Map([[a, [0, 0]], [b, [0, 4]], [c, [0, 7]]])
  expect(sideColumnCount(m, [a, b])).toBe(5)   // cols 0 and 4 → 5
  expect(sideColumnCount(m, [c])).toBe(8)       // col 7 → 8 (global numbering)
})
```

- [ ] **Step 2: Use it in `generateOverlay`**

Replace `'&default_transform': right && { colOffset: 7 }` with:

```ts
const offset = options.board == 'lemon-wireless'
  ? 7
  : (config.left ? sideColumnCount(matrix, config.left.c.keys) : 7)
// ...
'&default_transform': right && { colOffset: offset },
```

Add `matrix` to `generateOverlay`'s parameters if not already present (it currently receives `matrix`). Import `sideColumnCount` in `zmk.ts`.

- [ ] **Step 3: Run tests**

Run: `npx bun test src/routes/beta/lib/firmware/zmkBoards.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/beta/lib/firmware/zmk.ts src/routes/beta/lib/firmware/zmkBoards.test.ts
git commit -m "feat(zmk): derive right column offset for nice!nano split"
```

---

## Task 9: nice!nano conf, west/deps, and Azoteq overlay generation

Add board-specific `.conf`, `west.yml`/`deps.yml`, and the Azoteq trackpad overlay. For nice!nano the custom board overlay file is omitted (board is upstream).

**Files:**
- Modify: `src/routes/beta/lib/firmware/zmk.ts` (`generateConf`, `generateWestYaml`, `generateDepsYaml`, `generateModuleYaml`, `downloadZMKCode`)

- [ ] **Step 1: Branch `generateConf`**

In `generateConf` (`zmk.ts:318-341`), prepend nice!nano handling:

```ts
function generateConf(config: FullGeometry, options: ZMKOptions) {
  if (options.board == 'nicenano') {
    const hasAzoteq = Object.values(options.peripherals).some((p) => p.azoteq)
    return [
      'CONFIG_ZMK_SLEEP=y',
      ...(hasAzoteq
        ? [
          '',
          '# Azoteq IQS5xx trackpad',
          'CONFIG_I2C=y',
          'CONFIG_INPUT=y',
          'CONFIG_INPUT_AZOTEQ_IQS5XX=y',
          'CONFIG_ZMK_POINTING=y',
        ]
        : []),
    ].join('\n') + '\n'
  }
  // ...existing Lemon body unchanged...
}
```

- [ ] **Step 2: Branch west/deps**

Add nice!nano variants. For nice!nano, `west.yml` imports `zmk` from the `rianadon` fork (keeps `nice_nano_v2` + studio support) and adds the Azoteq driver; `deps.yml` lists the Azoteq project:

```ts
function generateWestYaml(options: ZMKOptions): string {
  if (options.board == 'nicenano') {
    return yamlFile({
      manifest: {
        remotes: [
          { name: 'zmkfirmware', 'url-base': 'https://github.com/zmkfirmware' },
          { name: 'rianadon', 'url-base': 'https://github.com/rianadon' },
        ],
        projects: [{ name: 'zmk', remote: 'rianadon', revision: 'main', import: 'app/west.yml' }],
        self: { path: 'config', import: 'deps.yml' },
      },
    })
  }
  // ...existing Lemon body...
}

function generateDepsYaml(options: ZMKOptions): string {
  if (options.board == 'nicenano') {
    return yamlFile({
      manifest: {
        remotes: [{ name: 'aym1607', 'url-base': 'https://github.com/AYM1607' }],
        projects: [
          // TODO before merge: pin `revision` to a specific commit SHA of the driver.
          { name: 'zmk-driver-azoteq-iqs5xx', remote: 'aym1607', revision: 'main' },
        ],
      },
    })
  }
  // ...existing Lemon body...
}
```

Update `generateModuleYaml` to drop the `vik-core` dependency for nice!nano:

```ts
function generateModuleYaml(options: ZMKOptions): string {
  return yamlFile({
    build: {
      depends: options.board == 'nicenano' ? [] : ['vik-core'],
      settings: { board_root: '.' },
    },
  })
}
```

Update the call sites of these three functions in `downloadZMKCode` to pass `options`.

- [ ] **Step 3: Add the Azoteq overlay generator**

Add a function that returns the trackpad overlay snippet, appended into the trackpad side's `.overlay`. The reset/rdy pins come from `assignNiceNanoPins`:

```ts
import { assignNiceNanoPins, matrixDims } from './zmkBoards'

function generateAzoteqOverlay(config: FullGeometry, matrix: Matrix, options: ZMKOptions): object {
  const { rows, columns } = matrixDims(matrix)
  const pins = assignNiceNanoPins({ rows, cols: columns, trackpad: true })
  return {
    'trackpad_input: trackpad_input': {
      compatible: 'zmk,input-listener',
      device: '<&trackpad>',
    },
    'pro_micro_i2c: &pro_micro_i2c': {
      status: 'okay',
      'trackpad: iqs5xx@74': {
        compatible: 'azoteq,iqs5xx',
        reg: 0x74,
        resetGpios: `<&pro_micro ${pins.resetPin} GPIO_ACTIVE_LOW>`,
        rdyGpios: `<&pro_micro ${pins.rdyPin} GPIO_ACTIVE_HIGH>`,
        oneFingerTap: true,
        pressAndHold: true,
        twoFingerTap: true,
        scroll: true,
        bottomBeta: 5,
        stationaryThreshold: 5,
      },
    },
  }
}
```

In `generateOverlay`, when `options.board == 'nicenano'` and this side has a `trackpad-azoteq` key, merge `generateAzoteqOverlay(...)` into the returned object's `/` siblings.

- [ ] **Step 4: Branch `downloadZMKCode` file set**

In `downloadZMKCode` (`zmk.ts:586-626`), skip the `boards/.../boards/<boardId>.overlay` file when `options.board == 'nicenano'`:

```ts
const board = boardProfile(options)
// ...
[`boards/shields/${folderName}`]: {
  ...(options.board == 'lemon-wireless'
    ? { [`boards/${board.boardId(options)}.overlay`]: strToU8(BOARD_OVERLAY) }
    : {}),
  // ...rest unchanged...
}
```

- [ ] **Step 5: Add tests**

```ts
import { generateConf, generateAzoteqOverlay } from './zmk' // add exports

test('nice!nano conf enables Azoteq pointing when present', () => {
  const opts = { board: 'nicenano', peripherals: { unibody: { azoteq: true } } } as any
  const conf = generateConf({ unibody: { c: { keys: [] } } } as any, opts)
  expect(conf).toContain('CONFIG_INPUT_AZOTEQ_IQS5XX=y')
  expect(conf).toContain('CONFIG_ZMK_POINTING=y')
})

test('nice!nano conf omits Azoteq flags without a trackpad', () => {
  const opts = { board: 'nicenano', peripherals: { unibody: { azoteq: false } } } as any
  expect(generateConf({ unibody: { c: { keys: [] } } } as any, opts)).not.toContain('AZOTEQ')
})

test('Azoteq overlay binds iqs5xx@74 on pro_micro_i2c', () => {
  const m: Matrix = new Map([[key(), [0, 0]]])
  const out = JSON.stringify(generateAzoteqOverlay({} as any, m, { peripherals: {} } as any))
  expect(out).toContain('azoteq,iqs5xx')
  expect(out).toContain('pro_micro_i2c')
})
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx bun test src/routes/beta/lib/firmware/` then `npm run check`
Expected: tests PASS; `npm run check` clean except the `PeaConfig.svelte` `board` field (next task).

- [ ] **Step 7: Commit**

```bash
git add src/routes/beta/lib/firmware/zmk.ts src/routes/beta/lib/firmware/zmkBoards.test.ts
git commit -m "feat(zmk): nice!nano conf, west deps, and Azoteq trackpad overlay"
```

---

## Task 10: PeaConfig UI — nice!nano block, peripheral detection, central-side check

**Files:**
- Modify: `src/routes/beta/lib/editor/PeaConfig.svelte`

- [ ] **Step 1: Add `board` to stored options + azoteq detection**

In the `storable<OptionsType>('programmingOptions', { ... })` default object (`:21-32`), add `board: 'lemon-wireless'` so the type matches `ZMKOptions`. In the `fullOptions` peripheral map (`:37-41`), add `azoteq` and set `board` from the microcontroller:

```ts
peripherals: mapObjNotNull(config, (c) => ({
  pmw3610: c.keys.some((k) => k.type == 'trackball' && k.variant.sensor == 'Skree (ZMK)'),
  cirque: c.keys.some((k) => k.type == 'trackpad-cirque'),
  azoteq: c.keys.some((k) => k.type == 'trackpad-azoteq'),
  encoder: !!encoderKeys(c).length,
})),
```

And derive the board:

```ts
$: zmkBoard = anyConfig.microcontroller == 'nrfmicro-or-nicenano' ? 'nicenano' : 'lemon-wireless'
$: fullOptions = { ...$options, board: zmkBoard, /* keyboardName, folderName, peripherals as before */ }
```

- [ ] **Step 2: Add the nice!nano UI block**

After the `lemon-wireless` block (`:159`), add:

```svelte
{#if anyConfig.microcontroller == 'nrfmicro-or-nicenano'}
  <Field name="Diode Direction" icon="diode-direction">
    <Select bind:value={$options.diodeDirection}>
      <option value="ROW2COL">ROW2COL</option>
      <option value="COL2ROW">COL2ROW</option>
    </Select>
  </Field>
  <Field name="Central (Plug into PC) Side" icon="pc">
    <Select bind:value={$options.centralSide}>
      <option value="left">Left</option>
      <option value="right">Right</option>
    </Select>
  </Field>
  <Field name="Enable ZMK Studio" icon="studio">
    <Checkbox bind:value={$options.enableStudio} />
  </Field>
  <Field name="Enable USB Logging" icon="debug" help="Writes debug information to a USB serial port">
    <Checkbox bind:value={$options.enableConsole} />
  </Field>

  {#if trackpadOnPeripheral}
    <InfoBox class="mt-4">
      Your trackpad is on the {trackpadSide} half, but the central side is set to {$options.centralSide}.
      Put the trackpad on the central side (or switch the central side) — pointer input is not yet
      forwarded from the peripheral half.
    </InfoBox>
  {/if}

  <button class="button" on:click={() => downloadZMKCode(geometry, matrix, fullOptions)}>
    Download ZMK code
  </button>

  <div class="mt-4 text-gray-500 dark:text-gray-200">
    Matrix and trackpad pins are auto-assigned to nice!nano pins. After downloading, open
    <code class="font-mono text-0.9em">{$modelName.toLowerCase()}.dtsi</code> for the pin list to
    solder against. Read the
    <a class="text-pink-600 underline" href="{base}/docs/firmware/" target="_blank">Firmware Autogen documentation</a>.
  </div>
{/if}
```

- [ ] **Step 3: Compute the central-side trackpad warning**

Add reactive vars in the script:

```ts
$: trackpadSide = config.left?.keys.some((k) => k.type == 'trackpad-azoteq')
  ? 'left'
  : config.right?.keys.some((k) => k.type == 'trackpad-azoteq')
  ? 'right'
  : undefined
$: trackpadOnPeripheral = !!config.right && !!trackpadSide && trackpadSide != $options.centralSide
```

- [ ] **Step 4: Run typecheck + dev smoke test**

Run: `npm run check`
Expected: clean (no `board`/`azoteq` errors).

Then `make dev`, open `http://localhost:5173/beta`, load a nice!nano config, build the matrix, and confirm the "Download ZMK code" button appears and downloads a zip. Inspect the zip: `build.yaml` has `board: nice_nano_v2`, `<name>.dtsi` has `&pro_micro` rows/cols and no `595`, and (with an azoteq trackpad) the trackpad-side `.overlay` has `iqs5xx@74` + `pro_micro_i2c` and the `.conf` has `CONFIG_INPUT_AZOTEQ_IQS5XX=y`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/beta/lib/editor/PeaConfig.svelte
git commit -m "feat(zmk): nice!nano firmware UI with auto-pin and trackpad checks"
```

---

## Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all `bun:test` files pass, including `firmwareHelpers.test.ts` (Lemon output unchanged) and `zmkBoards.test.ts`.

- [ ] **Step 2: Type + svelte check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 3: Lemon regression spot-check**

Generate a Lemon Wireless zip from the UI (or via an exported generator in a scratch test) and diff the `.dtsi` against `main`'s output for the same config — confirm it is identical (the profile extraction must not have changed Lemon bytes).

- [ ] **Step 4: nice!nano end-to-end review**

Download a zip for the Cosmotyl config (nice!nano split + azoteq). Manually verify file structure, pin comments, and the Azoteq west project. Note in the PR description that firmware was **not** compiled/flashed in-repo — the user validates on hardware.

- [ ] **Step 5: Commit any doc updates**

If `docs/docs/firmware/` needs a nice!nano section describing the auto pin assignment and the solder-to-these-pins table, add it and commit:

```bash
git add docs/docs/firmware/
git commit -m "docs: nice!nano ZMK firmware pin assignment"
```

---

## Self-Review Notes

- **Spec coverage:** board profile (Tasks 4-5), kscan/dims delegation (Task 7), pin assignment (Task 2), `pro_micro` refs (Task 3), diode-direction fix (Task 3, nice!nano only), split col-offset (Task 8), Azoteq overlay/west/conf (Task 9), UI + central-side constraint (Task 10), tests + Lemon regression (Tasks 4/7/11). All spec sections map to a task.
- **Known follow-ups (out of v1 scope, noted in spec):** peripheral-side pointing relay, RGB/encoders/PMW3610/Cirque on nice!nano, pinning the Azoteq driver SHA (flagged inline in Task 9 Step 2), and confirming exact `pro_micro_i2c` SDA/SCL pins for the solder doc (Task 11 Step 5).
- **Encoding gate:** resolved during planning to *global* column numbering; Lemon dims/offset stay fixed in its profile, so the refactor cannot change Lemon output. Task 11 Step 3 verifies this empirically.
