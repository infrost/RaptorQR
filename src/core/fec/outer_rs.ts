/**
 * Outer Reed-Solomon erasure code over GF(256).
 *
 * Provides systematic RS encoding/decoding across generations.
 * A transfer with G source generations gets P parity generations where
 * P = max(1, ceil(G * OUTER_EC_OVERHEAD)). Any G out of G+P generations
 * can recover the original file.
 *
 * Uses Lagrange interpolation with evaluation points x_i = α^i where α=2
 * is a primitive element of GF(256).
 *
 * @module
 */

import { GF256_RS_MAX_EVALUATION_POINTS } from '@/core/protocol/constants';
import { add, sub, mul, div, inv, pow } from './gf256';

const PRIMITIVE = 2; // α = 0x02

/** Compute α^i in GF(256). */
function fastEvalPoint(i: number): number {
  return pow(PRIMITIVE, i % 255);
}

/**
 * Compute Lagrange basis polynomial L_i(z) evaluated at point z,
 * where L_i(z) = Π_{j≠i} (z - x_j) / (x_i - x_j).
 */
function lagrangeCoeff(i: number, z: number, sourcePoints: number[]): number {
  let num = 1;
  let den = 1;
  const xi = sourcePoints[i]!;
  for (let j = 0; j < sourcePoints.length; j++) {
    if (j === i) continue;
    const xj = sourcePoints[j]!;
    num = mul(num, sub(z, xj));
    den = mul(den, sub(xi, xj));
  }
  return div(num, den);
}

/**
 * Encode source chunks into parity chunks using systematic Reed-Solomon.
 *
 * @param sourceChunks - Array of G source generation chunks
 * @param parityCount  - Number of parity generations P to create
 * @returns Array of P parity chunks
 */
export function encodeOuterRS(sourceChunks: Uint8Array[], parityCount: number): Uint8Array[] {
  const G = sourceChunks.length;
  const P = parityCount;
  if (P === 0 || G === 0) return [];
  assertSafeEvaluationPointCount(G, P);

  const symbolSize = sourceChunks[0]!.length;
  const sourcePoints = Array.from({ length: G }, (_, i) => fastEvalPoint(i));
  const parityPoints = Array.from({ length: P }, (_, p) => fastEvalPoint(G + p));

  // Precompute Lagrange coefficients L_i(z_p) for all source i and parity p
  const lagrangeCoeffs: number[][] = []; // [p][i]
  for (let p = 0; p < P; p++) {
    const row: number[] = [];
    for (let i = 0; i < G; i++) {
      row.push(lagrangeCoeff(i, parityPoints[p]!, sourcePoints));
    }
    lagrangeCoeffs.push(row);
  }

  // Compute parity chunks: parity[p][b] = Σ_i L_i(z_p) * source[i][b]
  const parityChunks: Uint8Array[] = [];
  for (let p = 0; p < P; p++) {
    const chunk = new Uint8Array(symbolSize);
    const coeffs = lagrangeCoeffs[p]!;
    for (let b = 0; b < symbolSize; b++) {
      let sum = 0;
      for (let g = 0; g < G; g++) {
        const c = coeffs[g]!;
        const s = sourceChunks[g]![b]!;
        if (c === 0 || s === 0) continue;
        sum = add(sum, mul(c, s));
      }
      chunk[b] = sum;
    }
    parityChunks.push(chunk);
  }

  return parityChunks;
}

/**
 * Recover missing source generations from received generations using RS decoding.
 *
 * @param received      - Map from generation index to chunk data
 * @param totalSource   - Total number of source generations G
 * @param parityCount   - Number of parity generations P
 * @returns Array of all G source chunks in order
 * @throws If not enough parity generations are available to recover
 */
export function decodeOuterRS(
  received: Map<number, Uint8Array>,
  totalSource: number,
  parityCount: number,
): Uint8Array[] {
  const G = totalSource;
  const P = parityCount;
  const total = G + P;
  if (P > 0) {
    assertSafeEvaluationPointCount(G, P);
  }

  // Determine which source generations are present/missing
  const presentSource: number[] = [];
  const missingSource: number[] = [];
  for (let g = 0; g < G; g++) {
    if (received.has(g)) {
      presentSource.push(g);
    } else {
      missingSource.push(g);
    }
  }

  if (missingSource.length === 0) {
    const result: Uint8Array[] = [];
    for (let g = 0; g < G; g++) {
      result.push(new Uint8Array(received.get(g)!));
    }
    return result;
  }

  // Need at least as many parity generations as missing source generations
  const receivedParity: number[] = [];
  for (let p = G; p < total; p++) {
    if (received.has(p)) {
      receivedParity.push(p);
    }
  }

  if (receivedParity.length < missingSource.length) {
    throw new Error(
      `Cannot recover: ${missingSource.length} missing source generations, ` +
        `but only ${receivedParity.length} parity generations available (need ${missingSource.length})`,
    );
  }

  // Use exactly as many parity generations as missing sources
  const usedParity = receivedParity.slice(0, missingSource.length);
  const symbolSize = received.get(presentSource[0] ?? usedParity[0])!.length;
  const sourcePoints = Array.from({ length: G }, (_, i) => fastEvalPoint(i));

  // Precompute Lagrange coefficients for used parity points
  const lagrangePresent: number[][] = []; // [q][presentSourceIdx]
  const lagrangeMissing: number[][] = []; // [q][missingSourceIdx]

  for (const pIdx of usedParity) {
    const pPoint = fastEvalPoint(pIdx);
    lagrangePresent.push(presentSource.map((sIdx) => lagrangeCoeff(sIdx, pPoint, sourcePoints)));
    lagrangeMissing.push(missingSource.map((mIdx) => lagrangeCoeff(mIdx, pPoint, sourcePoints)));
  }

  // Build A matrix and invert it
  const A = lagrangeMissing;
  const Ainv = invertMatrix(A);

  // For each byte position, solve for missing source values
  const recovered = new Map<number, Uint8Array>();

  for (let b = 0; b < symbolSize; b++) {
    // Compute b vector: parity_val - Σ present_source * L_i(z_p)
    const bvec: number[] = [];
    for (let q = 0; q < missingSource.length; q++) {
      const pIdx = usedParity[q]!;
      let val = received.get(pIdx)![b]!;
      for (let s = 0; s < presentSource.length; s++) {
        const coeff = lagrangePresent[q]![s]!;
        if (coeff === 0) continue;
        const sIdx = presentSource[s]!;
        const sval = received.get(sIdx)![b]!;
        if (sval === 0) continue;
        val = sub(val, mul(coeff, sval));
      }
      bvec.push(val);
    }

    // Solve: missing = Ainv * bvec
    for (let m = 0; m < missingSource.length; m++) {
      const genIdx = missingSource[m]!;
      if (!recovered.has(genIdx)) {
        recovered.set(genIdx, new Uint8Array(symbolSize));
      }
      let sum = 0;
      for (let q = 0; q < missingSource.length; q++) {
        const a = Ainv[m]![q]!;
        if (a === 0 || bvec[q] === 0) continue;
        sum = add(sum, mul(a, bvec[q]!));
      }
      recovered.get(genIdx)![b] = sum;
    }
  }

  // Assemble final result
  const result: Uint8Array[] = [];
  for (let g = 0; g < G; g++) {
    if (received.has(g)) {
      result.push(new Uint8Array(received.get(g)!));
    } else {
      result.push(recovered.get(g)!);
    }
  }
  return result;
}

/** Invert a square matrix over GF(256) using Gaussian elimination. */
function invertMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  if (n === 0) return [];
  if (n === 1) {
    const value = matrix[0]![0]!;
    if (value === 0) {
      throw new Error('Singular matrix in outer RS decode');
    }
    const invVal = inv(value);
    return [[invVal]];
  }

  // Augment [A | I]
  const aug: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [...matrix[i]!, ...Array(n).fill(0)];
    row[n + i] = 1;
    aug.push(row);
  }

  // Gaussian elimination to reduced row echelon form
  for (let col = 0; col < n; col++) {
    // Find pivot
    let pivotRow = -1;
    for (let row = col; row < n; row++) {
      if (aug[row]![col]! !== 0) {
        pivotRow = row;
        break;
      }
    }
    if (pivotRow === -1) {
      throw new Error('Singular matrix in outer RS decode');
    }

    // Swap to current row
    if (pivotRow !== col) {
      const tmp = aug[col]!;
      aug[col] = aug[pivotRow]!;
      aug[pivotRow] = tmp;
    }

    // Scale pivot row to make pivot = 1
    const pivVal = aug[col]![col]!;
    const pivInv = inv(pivVal);
    for (let j = col; j < 2 * n; j++) {
      aug[col]![j] = mul(aug[col]![j]!, pivInv);
    }

    // Eliminate this column from all other rows
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row]![col]!;
      if (factor === 0) continue;
      for (let j = col; j < 2 * n; j++) {
        aug[row]![j] = sub(aug[row]![j]!, mul(factor, aug[col]![j]!));
      }
    }
  }

  // Extract inverse from augmented part
  const invMatrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    invMatrix.push(aug[i]!.slice(n, 2 * n));
  }
  return invMatrix;
}

function assertSafeEvaluationPointCount(sourceCount: number, parityCount: number): void {
  const totalPoints = sourceCount + parityCount;
  if (totalPoints > GF256_RS_MAX_EVALUATION_POINTS) {
    throw new RangeError(
      `Outer RS over GF(256) supports at most ${GF256_RS_MAX_EVALUATION_POINTS} ` +
      `source+parity generations, got ${totalPoints}.`,
    );
  }
}
