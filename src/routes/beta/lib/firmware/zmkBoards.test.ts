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
