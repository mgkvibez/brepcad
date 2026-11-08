/**
 * The 2D sketch layer under a history-based CAD kernel.
 *
 * Every feature in a parametric CAD tool is built on sketches, and every sketch is constrained geometry. Before anything
 * extrudes, the model has to answer exact questions about lines and arcs: where do they intersect, is the profile closed,
 * how much area does it enclose, which side is out.
 *
 * Analytic answers, not sampled ones. A kernel that approximates a circle with segments produces fillets that are subtly
 * wrong and exports that cannot be machined, so circles stay arcs here and intersections are solved in closed form.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export type Entity =
  | { readonly kind: "line"; readonly a: Vec2; readonly b: Vec2 }
  | { readonly kind: "arc"; readonly centre: Vec2; readonly radius: number; readonly start: number; readonly end: number };

export interface BoundingBox {
  readonly min: Vec2;
  readonly max: Vec2;
}

const EPSILON = 1e-9;

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Normalises an angle to [0, 2pi). */
export function normaliseAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}

/**
 * The swept interval in radians, counter-clockwise.
 *
 * A full turn must be caught before normalisation: `2pi - 0` normalises to `0`, which would describe an arc that
 * contains only its start angle and enclose no area. That is exactly the bug the full-circle tests found.
 */
export function arcSpan(arc: Extract<Entity, { kind: "arc" }>): number {
  const raw = arc.end - arc.start;
  if (raw >= Math.PI * 2 - EPSILON) return Math.PI * 2;
  return normaliseAngle(raw);
}

/** True when `angle` lies on the arc's swept interval, walking counter-clockwise from start to end. Both ends count. */
export function angleOnArc(arc: Extract<Entity, { kind: "arc" }>, angle: number): boolean {
  if (arcSpan(arc) >= Math.PI * 2 - EPSILON) return true;
  const delta = normaliseAngle(angle - arc.start);
  return delta <= arcSpan(arc) + EPSILON;
}

export function pointOnArc(arc: Extract<Entity, { kind: "arc" }>, angle: number): Vec2 {
  return vec(arc.centre.x + arc.radius * Math.cos(angle), arc.centre.y + arc.radius * Math.sin(angle));
}

/** Line/line intersection, or null for parallel and collinear lines. */
export function lineLineIntersection(a: Extract<Entity, { kind: "line" }>, b: Extract<Entity, { kind: "line" }>): Vec2 | null {
  const r = vec(a.b.x - a.a.x, a.b.y - a.a.y);
  const s = vec(b.b.x - b.a.x, b.b.y - b.a.y);
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < EPSILON) return null;
  const t = ((b.a.x - a.a.x) * s.y - (b.a.y - a.a.y) * s.x) / denominator;
  return vec(a.a.x + t * r.x, a.a.y + t * r.y);
}

/** Line/arc intersections, filtered to the arc's swept interval. Zero, one or two points. */
export function lineArcIntersections(line: Extract<Entity, { kind: "line" }>, arc: Extract<Entity, { kind: "arc" }>): Vec2[] {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const fx = line.a.x - arc.centre.x;
  const fy = line.a.y - arc.centre.y;

  const a = dx * dx + dy * dy;
  if (a < EPSILON) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - arc.radius * arc.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -EPSILON) return [];

  const root = Math.sqrt(Math.max(0, discriminant));
  const solutions: Vec2[] = [];
  for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (t < -EPSILON || t > 1 + EPSILON) continue;
    const point = vec(line.a.x + t * dx, line.a.y + t * dy);
    const angle = Math.atan2(point.y - arc.centre.y, point.x - arc.centre.x);
    if (!angleOnArc(arc, normaliseAngle(angle))) continue;
    if (solutions.some((existing) => distance(existing, point) < 1e-7)) continue;
    solutions.push(point);
  }
  return solutions;
}

/**
 * Signed area of a closed profile by the shoelace rule, with arcs contributing exact circular segments.
 *
 * A positive result means counter-clockwise. CAD cares about the sign: it is how a hole is told from a solid.
 */
export function profileArea(entities: readonly Entity[]): number {
  let total = 0;
  for (const entity of entities) {
    if (entity.kind === "line") {
      total += (entity.a.x * entity.b.y - entity.b.x * entity.a.y) / 2;
      continue;
    }
    const span = arcSpan(entity);
    const startPoint = pointOnArc(entity, entity.start);
    const endPoint = pointOnArc(entity, entity.end);
    // Circular segment: chord contribution plus the signed sliver between chord and arc.
    total += (startPoint.x * endPoint.y - endPoint.x * startPoint.y) / 2;
    total += (entity.radius * entity.radius * (span - Math.sin(span))) / 2;
  }
  return total;
}

export function boundingBox(entities: readonly Entity[]): BoundingBox {
  if (entities.length === 0) throw new RangeError("no entities: an empty sketch has no bounding box");
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (p: Vec2): void => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const entity of entities) {
    if (entity.kind === "line") {
      include(entity.a);
      include(entity.b);
      continue;
    }
    // The extremes of an arc are its endpoints plus any axis crossing it sweeps through.
    include(pointOnArc(entity, entity.start));
    include(pointOnArc(entity, entity.end));
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      if (angleOnArc(entity, angle)) include(pointOnArc(entity, angle));
    }
  }
  return { min: vec(minX, minY), max: vec(maxX, maxY) };
}
