/**
 * Constraints, which is the difference between a drawing and a sketch.
 *
 * A sketch tool does not move geometry the way the user dragged it; it moves it the *least* amount that satisfies the
 * constraints, and that minimum-displacement question is linear algebra: minimise the distance from the current
 * configuration subject to the constraint equations. Doing that in floating point is how sketch tools end up with points
 * that drift by 1e-15 per drag, then refuse to close a profile that is visibly closed.
 *
 * So the solve here is exact: coordinates become rationals, the system is solved by Gaussian elimination over BigInt
 * fractions, and the result is converted back once at the end.
 *
 * Linear constraints (`horizontal`, `vertical`, `coincident`, `fixed`) are solved exactly and once. Angular ones
 * (`parallel`, `perpendicular`) are quadratic in the coordinates, so they cannot be solved by that method at all:
 * `solveLines` refuses them by name, and `solveSketch` iterates them, each step an exact rational projection, and
 * reports the residual it reached plus whether the answer came out exact. Tangency stays refused by name.
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
  | { readonly kind: "fixed"; readonly line: string; readonly at: End; readonly x: number; readonly y: number }
  | { readonly kind: "parallel"; readonly lineA: string; readonly lineB: string }
  | { readonly kind: "perpendicular"; readonly lineA: string; readonly lineB: string }
  | {
      readonly kind: "distance";
      readonly lineA: string;
      readonly endA: End;
      readonly lineB: string;
      readonly endB: End;
      /** The length the two points must be apart. Positive: zero distance is what `coincident` is for. */
      readonly value: number;
    }
  | { readonly kind: "angle"; readonly lineA: string; readonly lineB: string; readonly degrees: number }
  | { readonly kind: "tangent"; readonly lineA: string; readonly lineB: string };

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

  /**
   * The double's exact value, read off its bits.
   *
   * Round-tripping through decimal text looks equivalent and is not. `toFixed(20)` switches to exponential notation
   * above 1e21, so `BigInt("1e+200")` throws; and a coordinate below 1e-20 rounds to `0.00000000000000000000`, which
   * silently turns a small coordinate into the origin. A double *is* `mantissa * 2^exponent`, so reading the bits gives
   * the exact rational with no text in the way.
   */
  static from(value: number): Q {
    if (!Number.isFinite(value)) throw new ConstraintError(`constraint coordinate must be finite, got ${value}`);
    if (value === 0) return new Q(0n, 1n);
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    const high = view.getUint32(0);
    const low = view.getUint32(4);
    const sign = high >>> 31 === 1 ? -1n : 1n;
    const biased = (high >>> 20) & 0x7ff;
    const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    // subnormals have no implicit leading bit and a fixed exponent
    const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
    const exponent = (biased === 0 ? 1 : biased) - 1075;
    return exponent >= 0
      ? new Q(sign * (mantissa << BigInt(exponent)))
      : new Q(sign * mantissa, 1n << BigInt(-exponent));
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

  isNegative(): boolean {
    return this.n < 0n;
  }

  isZero(): boolean {
    return this.n === 0n;
  }

  /**
   * The nearest double, computed by scaling both sides down to a mantissa a double can hold.
   *
   * `Number(n) / Number(d)` is not equivalent: past 2^1024 either side becomes Infinity, and Infinity over Infinity is
   * NaN, which is the worst possible output for a CAD tool. Scaling first keeps the conversion finite for any rational
   * the solver can produce. The angular iteration's magnitude bound means `solveSketch` does not reach that case, so this
   * is covered by reasoning rather than by a test: it is here for direct `solveLines` callers, and so a magnitude bound
   * is not the only thing standing between an ill-conditioned solve and a NaN coordinate.
   */
  toNumber(): number {
    if (this.n === 0n) return 0;
    const negative = this.n < 0n !== this.d < 0n;
    const numerator = this.n < 0n ? -this.n : this.n;
    const denominator = this.d < 0n ? -this.d : this.d;
    const numeratorBits = numerator.toString(2).length;
    const denominatorBits = denominator.toString(2).length;
    const dropNumerator = Math.max(0, numeratorBits - 48);
    const dropDenominator = Math.max(0, denominatorBits - 48);
    const scaled =
      Number(numerator >> BigInt(dropNumerator)) / Number(denominator >> BigInt(dropDenominator));
    const value = scaled * 2 ** (dropNumerator - dropDenominator);
    return negative ? -value : value;
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

type Row = { coefficients: Q[]; target: Q; label: string };

/**
 * A constraint whose equation is quadratic in the coordinates, resolved to line indices.
 *
 * `parallel`, `perpendicular` and `angle` equate a determinant or a dot product, which is homogeneous and scale free.
 * `distance` equates `|P - Q|²` to a squared length, so it carries a target rather than being homogeneous. Both sorts
 * are iterated the same way: linearise about the current configuration and solve that exactly.
 */
interface QuadraticPair {
  readonly kind: "parallel" | "perpendicular" | "angle" | "distance" | "keepLength";
  readonly a: number;
  readonly b: number;
  readonly label: string;
  /**
   * Distance target in sketch units for `distance`; the squared length to hold for `keepLength`, which is an internal
   * gauge rather than a constraint and never appears in a report.
   */
  readonly value?: Q;
  /** The angle's target as an exact pair, so the residual can be computed without trigonometry. Present for `angle`. */
  readonly cos?: Q;
  readonly sin?: Q;
  readonly endA?: End;
  readonly endB?: End;
}

/** Where a line's endpoint lives in the unknown vector. */
function coordinate(lineIndex: number, end: End, axis: 0 | 1): number {
  return lineIndex * 4 + (end === "end" ? 2 : 0) + axis;
}

interface BuiltSystem {
  readonly rows: Row[];
  readonly quadratic: QuadraticPair[];
  readonly unknownCount: number;
  readonly u0: Q[];
  /** Lines whose length a `distance` constraint already pins, so the gauge below has nothing to add for them. */
  readonly lengthPinned: Set<number>;
}

function buildSystem(lines: readonly LineEntity[], constraints: readonly Constraint[]): BuiltSystem {
  const ids = new Map<string, number>();
  lines.forEach((line, index) => ids.set(line.id, index));
  const unknownCount = lines.length * 4;

  const u0: Q[] = [];
  for (const line of lines) {
    u0.push(Q.from(line.start.x), Q.from(line.start.y), Q.from(line.end.x), Q.from(line.end.y));
  }

  const rows: Row[] = [];
  const quadratic: QuadraticPair[] = [];
  const requireLine = (id: string, label: string): number => {
    const index = ids.get(id);
    if (index === undefined) throw new ConstraintError(`${label} refers to unknown line "${id}"`);
    return index;
  };

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
      case "parallel":
      case "perpendicular": {
        const a = requireLine(constraint.lineA, constraint.kind);
        const b = requireLine(constraint.lineB, constraint.kind);
        if (a === b) {
          throw new ConstraintError(
            `${constraint.kind}(${constraint.lineA}, ${constraint.lineB}) constrains a line against itself`,
          );
        }
        quadratic.push({
          kind: constraint.kind,
          a,
          b,
          label: `${constraint.kind}(${constraint.lineA}, ${constraint.lineB})`,
        });
        break;
      }
      case "distance": {
        const a = requireLine(constraint.lineA, "distance");
        const b = requireLine(constraint.lineB, "distance");
        if (a === b && constraint.endA === constraint.endB) {
          throw new ConstraintError(
            `distance(${constraint.lineA}.${constraint.endA}, ${constraint.lineB}.${constraint.endB}) is between a ` +
              "point and itself, which is zero for every sketch",
          );
        }
        if (!(constraint.value > 0)) {
          throw new ConstraintError(
            `distance(${constraint.lineA}.${constraint.endA}, ${constraint.lineB}.${constraint.endB}) must be a ` +
              `positive length, got ${constraint.value}`,
          );
        }
        quadratic.push({
          kind: "distance",
          a,
          b,
          value: Q.from(constraint.value),
          endA: constraint.endA,
          endB: constraint.endB,
          label:
            `distance(${constraint.lineA}.${constraint.endA}, ` +
            `${constraint.lineB}.${constraint.endB}) = ${constraint.value}`,
        });
        break;
      }
      case "angle": {
        const a = requireLine(constraint.lineA, "angle");
        const b = requireLine(constraint.lineB, "angle");
        if (a === b) {
          throw new ConstraintError(
            `angle(${constraint.lineA}, ${constraint.lineB}) constrains a line against itself`,
          );
        }
        if (!(constraint.degrees > 0 && constraint.degrees < 180)) {
          throw new ConstraintError(
            `angle(${constraint.lineA}, ${constraint.lineB}) must be between 0 and 180 degrees, got ` +
              `${constraint.degrees}: 0 and 180 are parallel and 90 is perpendicular, and those have their own names`,
          );
        }
        const radians = (constraint.degrees * Math.PI) / 180;
        // Two orientations satisfy "45° between these lines": one on each side. Which one is meant is decided by the
        // side the sketch is already drawn on, so the solver makes the small correction instead of swinging the line
        // around to the mirror answer. To get the other side, swap the line's endpoints.
        const firstDirection = direction(u0, a);
        const secondDirection = direction(u0, b);
        const currentDet = firstDirection.dx
          .mul(secondDirection.dy)
          .sub(firstDirection.dy.mul(secondDirection.dx));
        const side = currentDet.isNegative() ? -1 : 1;
        quadratic.push({
          kind: "angle",
          a,
          b,
          cos: Q.from(Math.cos(radians)),
          sin: Q.from(side * Math.sin(radians)),
          label: `angle(${constraint.lineA}, ${constraint.lineB}) = ${constraint.degrees}°`,
        });
        break;
      }
      default: {
        const never: { readonly kind: string } = constraint;
        if (never.kind === "tangent") {
          throw new ConstraintError(
            "tangent is refused by name rather than skipped: tangency is a statement about an arc's radius and centre, " +
              "and arcs are not part of the solver's unknowns yet, so there is nothing here for it to constrain. " +
              "Constrain the centre line of the arc with distance and angle instead, or leave the arc unconstrained",
          );
        }
        throw new ConstraintError(`unsupported constraint ${JSON.stringify(never)}`);
      }
    }
  }

  const lengthPinned = new Set<number>();
  for (const pair of quadratic) {
    if (pair.kind === "distance" && pair.a === pair.b) lengthPinned.add(pair.a);
  }

  return { rows, quadratic, unknownCount, u0, lengthPinned };
}

/** A line's direction vector as an exact rational pair. */
function direction(u: readonly Q[], lineIndex: number): { dx: Q; dy: Q } {
  const base = lineIndex * 4;
  return { dx: u[base + 2]!.sub(u[base]!), dy: u[base + 3]!.sub(u[base + 1]!) };
}

function squaredNorm(vector: { dx: Q; dy: Q }): Q {
  return vector.dx.mul(vector.dx).add(vector.dy.mul(vector.dy));
}

/**
 * The exact value of a quadratic constraint, in rationals. Zero means satisfied.
 *
 * `parallel` is the determinant of the two directions (zero when collinear), `perpendicular` their dot product (zero when
 * at right angles), `angle` the same pair combined as `det·cosθ - dot·sinθ`, which is `|u||v|·sin(φ - θ)` and
 * therefore zero exactly when the angle between the lines is θ. `distance` is `|P - Q|² - d²`, the squared form because
 * the unsquared one is not polynomial and would break the exactness arithmetic.
 */
function quadraticValue(pair: QuadraticPair, u: readonly Q[]): Q {
  const first = direction(u, pair.a);
  const second = direction(u, pair.b);
  const det = first.dx.mul(second.dy).sub(first.dy.mul(second.dx));
  const dotProduct = first.dx.mul(second.dx).add(first.dy.mul(second.dy));

  switch (pair.kind) {
    case "parallel":
      return det;
    case "perpendicular":
      return dotProduct;
    case "angle":
      return det.mul(pair.cos!).sub(dotProduct.mul(pair.sin!));
    case "keepLength":
    case "distance": {
      const firstPoint = { x: u[coordinate(pair.a, pair.endA!, 0)]!, y: u[coordinate(pair.a, pair.endA!, 1)]! };
      const secondPoint = { x: u[coordinate(pair.b, pair.endB!, 0)]!, y: u[coordinate(pair.b, pair.endB!, 1)]! };
      const dx = firstPoint.x.sub(secondPoint.x);
      const dy = firstPoint.y.sub(secondPoint.y);
      return dx.mul(dx).add(dy.mul(dy)).sub(pair.value!.mul(pair.value!));
    }
  }
}

/** Writes the gradient of the determinant of two directions into `row`. */
function detGradient(row: Q[], first: { dx: Q; dy: Q }, second: { dx: Q; dy: Q }, baseA: number, baseB: number): void {
  // d(det)/d(A.start) = (-vy, vx), d/d(A.end) = (vy, -vx), d/d(B.start) = (uy, -ux), d/d(B.end) = (-uy, ux)
  row[baseA] = second.dy.neg();
  row[baseA + 1] = second.dx;
  row[baseA + 2] = second.dy;
  row[baseA + 3] = second.dx.neg();
  row[baseB] = first.dy;
  row[baseB + 1] = first.dx.neg();
  row[baseB + 2] = first.dy.neg();
  row[baseB + 3] = first.dx;
}

/** Writes the gradient of the dot product of two directions into `row`. */
function dotGradient(row: Q[], first: { dx: Q; dy: Q }, second: { dx: Q; dy: Q }, baseA: number, baseB: number): void {
  // d(dot)/d(A.start) = (-vx, -vy), d/d(A.end) = (vx, vy), d/d(B.start) = (-ux, -uy), d/d(B.end) = (ux, uy)
  row[baseA] = second.dx.neg();
  row[baseA + 1] = second.dy.neg();
  row[baseA + 2] = second.dx;
  row[baseA + 3] = second.dy;
  row[baseB] = first.dx.neg();
  row[baseB + 1] = first.dy.neg();
  row[baseB + 2] = first.dx;
  row[baseB + 3] = first.dy;
}

/**
 * The Newton row of a quadratic constraint, taken at `u`.
 *
 * The gradient of `det(u, v)` and of `u·v` are both linear in the *other* line's direction, so freezing both directions
 * at `u` turns the quadratic into one linear equation: the change that removes the current error to first order. When a
 * line's direction cannot move (it is pinned by `fixed`, `horizontal` or `vertical`), this row is not an approximation
 * at all, and the solve lands on the constraint exactly; `solveSketch` reports which case happened.
 *
 * `distance` is the same idea without the freezing: its gradient, `2(P - Q)` at one end and `-2(P - Q)` at the other, is
 * linear in the coordinates, so the row is the honest gradient of a quadratic and Newton converges on it quadratically.
 */
function quadraticRow(pair: QuadraticPair, u: readonly Q[], unknownCount: number): Row {
  const row = zeroRow(unknownCount);
  const baseA = pair.a * 4;
  const baseB = pair.b * 4;

  if (pair.kind === "distance" || pair.kind === "keepLength") {
    const firstPoint = { x: u[coordinate(pair.a, pair.endA!, 0)]!, y: u[coordinate(pair.a, pair.endA!, 1)]! };
    const secondPoint = { x: u[coordinate(pair.b, pair.endB!, 0)]!, y: u[coordinate(pair.b, pair.endB!, 1)]! };
    const TWO = new Q(2n, 1n);
    const dx = firstPoint.x.sub(secondPoint.x).mul(TWO);
    const dy = firstPoint.y.sub(secondPoint.y).mul(TWO);
    row[coordinate(pair.a, pair.endA!, 0)] = dx;
    row[coordinate(pair.a, pair.endA!, 1)] = dy;
    row[coordinate(pair.b, pair.endB!, 0)] = dx.neg();
    row[coordinate(pair.b, pair.endB!, 1)] = dy.neg();
  } else {
    const first = direction(u, pair.a);
    const second = direction(u, pair.b);
    const detPart = zeroRow(unknownCount);
    const dotPart = zeroRow(unknownCount);
    detGradient(detPart, first, second, baseA, baseB);
    dotGradient(dotPart, first, second, baseA, baseB);
    const detWeight = pair.kind === "parallel" ? ONE : pair.kind === "angle" ? pair.cos! : ZERO;
    const dotWeight =
      pair.kind === "parallel" ? ZERO : pair.kind === "perpendicular" ? ONE : pair.sin!.neg();
    for (let index = 0; index < unknownCount; index += 1) {
      row[index] = detPart[index]!.mul(detWeight).add(dotPart[index]!.mul(dotWeight));
    }
  }

  const current = dot(row, u);
  return { coefficients: row, target: current.sub(quadraticValue(pair, u)), label: pair.label };
}

/**
 * Solve the linear constraints, moving geometry as little as possible.
 *
 * Substituting out the satisfied constraints gives `u = u0 + Aᵀλ`, so the least-change solution is the one that solves
 * `A Aᵀ λ = b - A u0`. If `A Aᵀ` is singular the constraints are contradictory or duplicated, and that is refused with
 * the offending constraint named rather than silently divided through.
 *
 * Angular constraints are refused here by name. They are not linear in the coordinates, and the whole point of this
 * solver is that it never quietly solves a different problem: `solveSketch` takes them, iterates them, and says how far
 * it got.
 */
export function solveLines(lines: readonly LineEntity[], constraints: readonly Constraint[]): LineEntity[] {
  if (lines.length === 0) return [];
  const built = buildSystem(lines, constraints);
  const first = built.quadratic[0];
  if (first !== undefined) {
    throw new ConstraintError(
      `${first.label} is quadratic, not linear: solveLines solves only constraints that are exactly linear in the ` +
        "coordinates. Use solveSketch, which iterates the quadratic ones and reports the residual it reached",
    );
  }
  if (built.rows.length === 0) return lines.map((line) => ({ ...line }));
  return toLines(solveSystem(built.u0, built.rows), lines);
}

export interface SolveReport {
  readonly lines: readonly LineEntity[];
  /** Linear solves performed. One when every constraint was linear; more when angular ones had to be iterated. */
  readonly iterations: number;
  /**
   * Worst relative error across the quadratic constraints: `|sin|` for parallel, `|cos|` for perpendicular,
   * `|sin(φ-θ)|` for an angle, and the relative length error for a distance. Zero means exact.
   */
  readonly residual: number;
  /** True when every angular constraint holds exactly in rationals, not merely within tolerance. */
  readonly exact: boolean;
}

export interface SolveOptions {
  /** Iterations allowed for angular constraints. Default 32. */
  readonly maxIterations?: number;
  /** Relative angular error accepted as solved. Default 1e-12, which is a million times tighter than a drawing needs. */
  readonly tolerance?: number;
}

const DEFAULT_MAX_ITERATIONS = 32;
const DEFAULT_TOLERANCE = 1e-12;

/**
 * Solve a sketch with linear *and* angular constraints.
 *
 * Linear constraints are solved exactly, first, and the angular ones are projected on top: each step linearises them
 * about the current configuration and solves that exactly in rationals, so no step introduces rounding. The linear rows
 * are solved before the first linearisation, so every angular row is taken about a configuration that already obeys
 * them; that is not an optimisation, it is what makes `iterations` mean one thing (exact linear solves performed)
 * whether or not the sketch has angular constraints.
 *
 * The report says which kind of answer came out, and the distinction is not cosmetic:
 *
 * 1. `exact: true` — the angular equations evaluate to exactly zero in rationals. This is the re-solve after a drag,
 *    where the sketch already satisfies them, and it happens to land on the root.
 * 2. `exact: false, residual <= tolerance` — the observed case for fresh geometry, even with both directions pinned by
 *    `horizontal`, `vertical` or `fixed`. Newton's method on a quadratic closes on the root without ever arriving in
 *    exact arithmetic, so the residual is what tells the truth: 6e-33 is a square edge, and it is not a claim of
 *    exactness. A caller that requires exactness reads `exact`; a caller that requires a straight edge reads `residual`.
 *
 * A failure to converge is an error, not a sketch that looks approximately square.
 */
export function solveSketch(
  lines: readonly LineEntity[],
  constraints: readonly Constraint[],
  options: SolveOptions = {},
): SolveReport {
  if (lines.length === 0) return { lines: [], iterations: 0, residual: 0, exact: true };
  const built = buildSystem(lines, constraints);
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;

  if (built.quadratic.length === 0) {
    const solved =
      built.rows.length === 0
        ? lines.map((line) => ({ ...line }))
        : toLines(solveSystem(built.u0, built.rows), lines);
    return { lines: solved, iterations: built.rows.length === 0 ? 0 : 1, residual: 0, exact: true };
  }

  for (const pair of built.quadratic) {
    for (const index of [pair.a, pair.b]) {
      if (squaredNorm(direction(built.u0, index)).isZero()) {
        throw new ConstraintError(
          `${pair.label} needs a direction, but line "${lines[index]!.id}" has zero length`,
        );
      }
    }
  }

  // The linear rows alone first, so every angular row below is linearised about a configuration that obeys them.
  let current = built.rows.length === 0 ? built.u0 : solveSystem(built.u0, built.rows);
  let iterations = built.rows.length === 0 ? 0 : 1;
  checkRepresentable(current, lines, built.quadratic);

  for (let step = 0; ; step += 1) {
    const report = measure(built.quadratic, current);
    const settled = {
      lines: toLines(current, lines),
      iterations,
      residual: report.residual,
      exact: report.exact,
    };
    if (report.exact || report.residual <= tolerance) return settled;
    if (step === maxIterations) {
      throw new ConstraintError(
        `angular constraints did not converge in ${maxIterations} iterations: ` +
          `${built.quadratic.map((pair) => pair.label).join(", ")} still off by ${report.residual}`,
      );
    }
    const rows = [...built.rows, ...built.quadratic.map((pair) => quadraticRow(pair, current, built.unknownCount))];
    const next = preserveLengths(built, current, solveSystem(current, rows));
    iterations += 1;
    checkRepresentable(next, lines, built.quadratic);
    const moved = next.some((value, index) => !value.sub(current[index]!).isZero());
    if (!moved) {
      throw new ConstraintError(
        `${built.quadratic.map((pair) => pair.label).join(", ")} cannot be satisfied: the solver stopped moving with a ` +
          `relative error of ${report.residual}`,
      );
    }
    current = reanchored(next);
  }
}

/** The lines an angular constraint acts on and no `distance` constraint has already pinned. */
function gaugeTargets(built: BuiltSystem): number[] {
  const targets = new Set<number>();
  for (const pair of built.quadratic) {
    if (pair.kind === "distance" || pair.kind === "keepLength") continue;
    for (const index of [pair.a, pair.b]) {
      if (!built.lengthPinned.has(index)) targets.add(index);
    }
  }
  return [...targets];
}

/**
 * Removes the part of a Newton step that shrinks a line, leaving the rotation.
 *
 * Every angular equation here is homogeneous of degree two, so `u = 0` satisfies it trivially and a step taken along the
 * gradient always has a radial component pointing inwards. Measured on `angle(b, a) = 45°` over a 10-long horizontal and
 * an 11.7-long line at 31°: the residual fell 113 → 27.9 as expected, both lines then halved in length, and the next
 * iterations ran past every bound the solver has. Projecting the step back onto "the length does not change" makes it a
 * rotation about the endpoints' midpoint, which is what "make this line 45° to that one" means, and which a caller can
 * draw.
 *
 * The projection is `(ΔP - ΔQ)·(P - Q) = 0`, solved by shifting one end up and the other down by the same amount so
 * the midpoint stays put, and done in exact rationals like everything else. Lines whose length a `distance` constraint
 * already fixes are left alone, and so is a length the caller is asking to change.
 */
function preserveLengths(built: BuiltSystem, before: readonly Q[], after: readonly Q[]): Q[] {
  const out = after.slice();
  const half = new Q(1n, 2n);
  for (const index of gaugeTargets(built)) {
    const base = index * 4;
    const dx = before[base + 2]!.sub(before[base]!);
    const dy = before[base + 3]!.sub(before[base + 1]!);
    const squared = dx.mul(dx).add(dy.mul(dy));
    if (squared.isZero()) continue;
    const moveX = out[base]!.sub(before[base]!).sub(out[base + 2]!.sub(before[base + 2]!));
    const moveY = out[base + 1]!.sub(before[base + 1]!).sub(out[base + 3]!.sub(before[base + 3]!));
    const radial = moveX.mul(dx).add(moveY.mul(dy));
    if (radial.isZero()) continue;
    const correction = radial.div(squared).mul(half);
    const shiftX = correction.mul(dx);
    const shiftY = correction.mul(dy);
    out[base] = out[base]!.sub(shiftX);
    out[base + 1] = out[base + 1]!.sub(shiftY);
    out[base + 2] = out[base + 2]!.add(shiftX);
    out[base + 3] = out[base + 3]!.add(shiftY);
  }
  return out;
}

/**
 * Refuse a configuration that a caller could not draw./**
 * Refuse a configuration that a caller could not draw.
 *
 * Three ways the iteration can go wrong while still producing numbers: a coordinate too large for a double (which used
 * to come out as NaN), a coordinate too large for any sketch, and a line collapsing to zero length, which satisfies
 * every angular equation and no user. All three are named here instead of being returned as a solved sketch.
 *
 * The magnitude bound is not defensive padding, it is what makes an unsatisfiable angular set return at all. `parallel`
 * and `perpendicular` over the same pair have no solution except a collapsed line, so Newton never converges: measured
 * on that case, the coordinates grow from 4 bits to 9, 23, 65, 190, 566 and 1695 bits over six iterations, roughly
 * tripling per step. Without a bound the solver does not produce a wrong answer, it never returns one; the default
 * budget of 32 iterations would mean rationals with more digits than there are atoms in the room.
 */
const MAX_COORDINATE = 1e12;

/**
 * Rounds a step's result to the doubles it will be reported as.
 *
 * The exactness of a step is not in doubt; the size of its denominators is. An exact rational target such as
 * `cos 45° = 0.7071067811865461` is a fraction with a 53-bit denominator, and each iteration multiplies the geometry by
 * it and by the Lagrange multipliers, so the bit length roughly doubles per step. Measured on `angle = 45°`: exact in
 * every step, and by the third step the coordinates were ~10 in value with numerators past 2^256, which the solver took
 * for a runaway and refused. Re-anchoring each step to the double the caller will receive keeps the rationals at the width of
 * the numbers the API actually returns, and changes no result that could be observed through it.
 */
function reanchored(u: readonly Q[]): Q[] {
  return u.map((value) => Q.from(value.toNumber()));
}

function checkRepresentable(
  u: readonly Q[],
  lines: readonly LineEntity[],
  quadratic: readonly QuadraticPair[],
): void {
  for (let index = 0; index < lines.length; index += 1) {
    const base = index * 4;
    const values = [u[base]!, u[base + 1]!, u[base + 2]!, u[base + 3]!];
    if (!values.every((value) => Number.isFinite(value.toNumber()))) {
      throw new ConstraintError(
        `line "${lines[index]!.id}" left the range a sketch can hold: the constraints drive its coordinates past ` +
          "the largest number a double can represent, which means they cannot all be satisfied",
      );
    }
    const widest = values.reduce((most, value) => Math.max(most, Math.abs(value.toNumber())), 0);
    if (widest > MAX_COORDINATE) {
      throw new ConstraintError(
        `line "${lines[index]!.id}" left the range a sketch can hold while satisfying ` +
          `${quadratic.map((pair) => pair.label).join(", ")}: its coordinates grew past ${MAX_COORDINATE}, which no ` +
          "drawing reaches, so those constraints cannot all be satisfied",
      );
    }
    if (quadratic.length > 0 && squaredNorm(direction(u, index)).isZero()) {
      const named = quadratic
        .filter((pair) => pair.a === index || pair.b === index)
        .map((pair) => pair.label)
        .join(", ");
      throw new ConstraintError(
        `line "${lines[index]!.id}" collapsed to zero length while satisfying ${named}: those constraints can only ` +
          "hold together if the line disappears, so they are unsatisfiable as given",
      );
    }
  }
}

/**
 * The worst relative error across every quadratic constraint, plus whether all of them are exactly zero.
 *
 * Exactness is decided in rationals, where "zero" means zero. The reported number is computed in doubles on purpose:
 * the rational ratio `g² / (|u|²|v|²)` has a numerator and denominator that both grow with every iteration, and
 * converting that quotient overflows to Infinity long before the geometry is anywhere near wrong.
 *
 * The four kinds are made comparable by dividing by the scale each one is homogeneous in: two line lengths for the
 * angular ones, the target length squared for a distance. What comes out is dimensionless, so "1e-12" means the same
 * thing whether the sketch is drawn in millimetres or in metres.
 */
function measure(quadratic: readonly QuadraticPair[], u: readonly Q[]): { exact: boolean; residual: number } {
  let worst = 0;
  let exact = true;
  for (const pair of quadratic) {
    if (pair.kind === "keepLength") continue;
    const first = direction(u, pair.a);
    const second = direction(u, pair.b);
    // a collapsed line satisfies every angular equation trivially, which is not a sketch anyone wants
    if (pair.kind !== "distance" && (squaredNorm(first).isZero() || squaredNorm(second).isZero())) {
      return { exact: false, residual: Number.POSITIVE_INFINITY };
    }
    if (quadraticValue(pair, u).isZero()) continue;
    exact = false;

    if (pair.kind === "distance") {
      const dx = u[coordinate(pair.a, pair.endA!, 0)]!.toNumber() - u[coordinate(pair.b, pair.endB!, 0)]!.toNumber();
      const dy = u[coordinate(pair.a, pair.endA!, 1)]!.toNumber() - u[coordinate(pair.b, pair.endB!, 1)]!.toNumber();
      const error = Math.abs(Math.hypot(dx, dy) - pair.value!.toNumber()) / pair.value!.toNumber();
      if (error > worst) worst = error;
      continue;
    }

    const ax = first.dx.toNumber();
    const ay = first.dy.toNumber();
    const bx = second.dx.toNumber();
    const by = second.dy.toNumber();
    const normA = Math.hypot(ax, ay);
    const normB = Math.hypot(bx, by);
    if (normA === 0 || normB === 0) return { exact: false, residual: Number.POSITIVE_INFINITY };
    const det = ax * by - ay * bx;
    const dotProduct = ax * bx + ay * by;
    const scale = normA * normB;
    const error =
      pair.kind === "parallel"
        ? Math.abs(det) / scale
        : pair.kind === "perpendicular"
          ? Math.abs(dotProduct) / scale
          : Math.abs(det * pair.cos!.toNumber() - dotProduct * pair.sin!.toNumber()) / scale;
    if (error > worst) worst = error;
  }
  return { exact, residual: worst };
}

/** One least-change solve of a linear system: `A Aᵀ λ = b - A u0`, then `u = u0 + Aᵀλ`. */
function solveSystem(u0: readonly Q[], rows: readonly Row[]): Q[] {
  if (rows.length === 0) return u0.slice();
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
    for (let unknown = 0; unknown < coefficients.length; unknown += 1) {
      const coefficient = coefficients[unknown]!;
      if (!coefficient.isZero()) updated[unknown] = updated[unknown]!.add(coefficient.mul(factor));
    }
  }
  return updated;
}

function toLines(u: readonly Q[], lines: readonly LineEntity[]): LineEntity[] {
  return lines.map((line, index) => ({
    kind: "line",
    id: line.id,
    start: { x: u[index * 4]!.toNumber(), y: u[index * 4 + 1]!.toNumber() },
    end: { x: u[index * 4 + 2]!.toNumber(), y: u[index * 4 + 3]!.toNumber() },
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

function residual(row: Row, u0: readonly Q[]): Q {
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
