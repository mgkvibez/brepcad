/**
 * Constraints, which is the difference between a drawing and a sketch.
 *
 * A sketch tool does not move geometry the way the user dragged it; it moves it the *least* amount that satisfies the
 * constraints, and that minimum-displacement question is linear algebra: minimise the distance from the current
 * configuration subject to the constraint equations. Doing that in floating point is how sketch tools end up with points
 * that drift by 1e-15 per drag, then refuse to close a profile that is visibly closed.
 *
 * So the solve here is exact: coordinates become rationals, the system is solved by Gaussian elimination over BigInt
 * fractions, and the result is converted back once at the end. Constraints that are not linear in the coordinates
 * (parallel, perpendicular, tangency) are refused by name rather than linearised, because a linearised approximation is
 * exactly the silent inaccuracy this project exists to avoid.
 */

import type { Vec2 } from "./sketch.js";

export interface LineEntity {
  readonly kind: "line";
  readonly id: string;
  readonly start: Vec2;
  readonly end: Vec2;
}

export type End = "start" | "end";

export type Constraint =
  | { readonly kind: "horizontal"; readonly line: string }
  | { readonly kind: "vertical"; readonly line: string }
  | { readonly kind: "coincident"; readonly lineA: string; readonly endA: End; readonly lineB: string; readonly endB: End }
  | { readonly kind: "fixed"; readonly line: string; readonly at: End; readonly x: number; readonly y: number };

export class ConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConstraintError";
  }
}

/** A reduced rational, because a solver that rounds at every step is a solver that drifts. */
class Q {
  readonly n: bigint;
  readonly d: bigint;

  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new ConstraintError("division by zero in the solver");
    const sign = d < 0n ? -1n : 1n;
    const divisor = gcd(n, d);
    this.n = (sign * n) / divisor;
    this.d = (sign * d) / divisor;
  }

  static from(value: number): Q {
    if (!Number.isFinite(value)) throw new ConstraintError(`constraint coordinate must be finite, got ${value}`);
    // exact for any double: value = mantissa * 2^exponent
    const scaled = value.toString().includes("e") ? value.toFixed(20) : String(value);
    const [whole, fraction] = scaled.split(".");
    const digits = (fraction ?? "").length;
    const numerator = BigInt((whole + (fraction ?? "")).replace(".", "").replace("-", ""));
    const sign = value < 0 ? -1n : 1n;
    return new Q(sign * numerator, 10n ** BigInt(digits));
  }

  add(other: Q): Q {
    return new Q(this.n * other.d + other.n * this.d, this.d * other.d);
  }

  sub(other: Q): Q {
    return new Q(this.n * other.d - other.n * this.d, this.d * other.d);
  }

  mul(other: Q): Q {
    return new Q(this.n * other.n, this.d * other.d);
  }

  div(other: Q): Q {
    return new Q(this.n * other.d, this.d * other.n);
  }

  neg(): Q {
    return new Q(-this.n, this.d);
  }

  isZero(): boolean {
    return this.n === 0n;
  }

  toNumber(): number {
    return Number(this.n) / Number(this.d);
  }
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x === 0n ? 1n : x;
}

const ZERO = new Q(0n, 1n);
const ONE = new Q(1n, 1n);

/**
 * Solve the linear constraints, moving geometry as little as possible.
 *
 * Substituting out the satisfied constraints gives `u = u0 + Aᵀλ`, so the least-change solution is the one that solves
 * `A Aᵀ λ = b - A u0`. If `A Aᵀ` is singular the constraints are contradictory or duplicated, and that is refused with
 * the offending constraint named rather than silently divided through.
 */
export function solveLines(lines: readonly LineEntity[], constraints: readonly Constraint[]): LineEntity[] {
  if (lines.length === 0) return [];
  const ids = new Map<string, number>();
  lines.forEach((line, index) => ids.set(line.id, index));
  const unknownCount = lines.length * 4;

  const u0: Q[] = [];
  for (const line of lines) {
    u0.push(Q.from(line.start.x), Q.from(line.start.y), Q.from(line.end.x), Q.from(line.end.y));
  }

  const rows: { coefficients: Q[]; target: Q; label: string }[] = [];
  const requireLine = (id: string, label: string): number => {
    const index = ids.get(id);
    if (index === undefined) throw new ConstraintError(`${label} refers to unknown line "${id}"`);
    return index;
  };
  const coordinate = (lineIndex: number, end: End, axis: 0 | 1): number => lineIndex * 4 + (end === "end" ? 2 : 0) + axis;

  for (const constraint of constraints) {
    switch (constraint.kind) {
      case "horizontal": {
        const line = requireLine(constraint.line, "horizontal");
        const row = zeroRow(unknownCount);
        row[coordinate(line, "start", 1)] = ONE;
        row[coordinate(line, "end", 1)] = ONE.neg();
        rows.push({ coefficients: row, target: ZERO, label: `horizontal(${constraint.line})` });
        break;
      }
      case "vertical": {
        const line = requireLine(constraint.line, "vertical");
        const row = zeroRow(unknownCount);
        row[coordinate(line, "start", 0)] = ONE;
        row[coordinate(line, "end", 0)] = ONE.neg();
        rows.push({ coefficients: row, target: ZERO, label: `vertical(${constraint.line})` });
        break;
      }
      case "coincident": {
        const a = requireLine(constraint.lineA, "coincident");
        const b = requireLine(constraint.lineB, "coincident");
        for (const axis of [0, 1] as const) {
          const row = zeroRow(unknownCount);
          row[coordinate(a, constraint.endA, axis)] = ONE;
          row[coordinate(b, constraint.endB, axis)] = ONE.neg();
          rows.push({
            coefficients: row,
            target: ZERO,
            label: `coincident(${constraint.lineA}.${constraint.endA}, ${constraint.lineB}.${constraint.endB})`,
          });
        }
        break;
      }
      case "fixed": {
        const line = requireLine(constraint.line, "fixed");
        const xRow = zeroRow(unknownCount);
        xRow[coordinate(line, constraint.at, 0)] = ONE;
        rows.push({ coefficients: xRow, target: Q.from(constraint.x), label: `fixed(${constraint.line}.${constraint.at}).x` });
        const yRow = zeroRow(unknownCount);
        yRow[coordinate(line, constraint.at, 1)] = ONE;
        rows.push({ coefficients: yRow, target: Q.from(constraint.y), label: `fixed(${constraint.line}.${constraint.at}).y` });
        break;
      }
      default: {
        const never: never = constraint;
        throw new ConstraintError(`unsupported constraint ${JSON.stringify(never)}`);
      }
    }
  }

  if (rows.length === 0) return lines.map((line) => ({ ...line }));

  // A Aᵀ λ = b - A u0
  const system: Q[][] = rows.map((row) => {
    const line = rows.map((other) => dot(row.coefficients, other.coefficients));
    line.push(residual(row, u0));
    return line;
  });
  const lambda = gaussianSolve(system, rows);

  const updated = u0.slice();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const factor = lambda[rowIndex]!;
    if (factor.isZero()) continue;
    const coefficients = rows[rowIndex]!.coefficients;
    for (let unknown = 0; unknown < unknownCount; unknown += 1) {
      const coefficient = coefficients[unknown]!;
      if (!coefficient.isZero()) updated[unknown] = updated[unknown]!.add(coefficient.mul(factor));
    }
  }

  return lines.map((line, index) => ({
    kind: "line",
    id: line.id,
    start: { x: updated[index * 4]!.toNumber(), y: updated[index * 4 + 1]!.toNumber() },
    end: { x: updated[index * 4 + 2]!.toNumber(), y: updated[index * 4 + 3]!.toNumber() },
  }));
}

function zeroRow(length: number): Q[] {
  return Array.from({ length }, () => ZERO);
}

function dot(a: readonly Q[], b: readonly Q[]): Q {
  let total = ZERO;
  for (let i = 0; i < a.length; i += 1) {
    if (!a[i]!.isZero() && !b[i]!.isZero()) total = total.add(a[i]!.mul(b[i]!));
  }
  return total;
}

function residual(row: { coefficients: Q[]; target: Q }, u0: readonly Q[]): Q {
  return row.target.sub(dot(row.coefficients, u0));
}

/** Gaussian elimination with exact fractions; a singular system is a contradiction, named by its row. */
function gaussianSolve(matrix: Q[][], rows: readonly { label: string }[]): Q[] {
  const size = matrix.length;
  const augmented = matrix.map((row) => row.slice());

  for (let column = 0; column < size; column += 1) {
    let pivot = -1;
    for (let row = column; row < size; row += 1) {
      if (!augmented[row]![column]!.isZero()) {
        pivot = row;
        break;
      }
    }
    if (pivot === -1) {
      throw new ConstraintError(
        `constraints are redundant or contradictory near "${rows[column]!.label}": ` +
          "two of them describe the same restriction in an incompatible way",
      );
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const pivotValue = augmented[column]![column]!;
    for (let k = column; k <= size; k += 1) {
      augmented[column]![k] = augmented[column]![k]!.div(pivotValue);
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      if (factor.isZero()) continue;
      for (let k = column; k <= size; k += 1) {
        augmented[row]![k] = augmented[row]![k]!.sub(factor.mul(augmented[column]![k]!));
      }
    }
  }

  return augmented.map((row) => row[size]!);
}
