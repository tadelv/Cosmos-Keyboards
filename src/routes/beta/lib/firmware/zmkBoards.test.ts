import { expect, test } from 'bun:test'
import type { CuttleKey } from '$lib/worker/config'
import type { Matrix } from './firmwareHelpers'
import { assignNiceNanoPins, matrixDims, NICENANO_PIN_ORDER } from './zmkBoards'

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
