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
