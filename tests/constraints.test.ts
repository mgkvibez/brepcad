import { describe, expect, it } from "vitest";

import { ConstraintError, solveLines, solveSketch, type Constraint, type LineEntity } from "../src/constraints.js";
import { lineArcIntersections } from "../src/sketch.js";

const line = (id: string, x1: number, y1: number, x2: number, y2: number): LineEntity => ({
  kind: "line",
  id,
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});

describe("constraint solving", () => {
  it("returns the geometry untouched when there is nothing to satisfy", () => {
    const lines = [line("a", 0, 0, 10, 3)];
    expect(solveLines(lines, [])).toEqual(lines);
  });

  it("makes a line horizontal by splitting the correction, not by snapping one end", () => {
    const [solved] = solveLines([line("a", 0, 0, 10, 4)], [{ kind: "horizontal", line: "a" }]);
    expect(solved!.start.y).toBeCloseTo(2, 12);
    expect(solved!.end.y).toBeCloseTo(2, 12);
    expect(solved!.start.x).toBeCloseTo(0, 12);
    expect(solved!.end.x).toBeCloseTo(10, 12);
  });

  it("makes a line vertical the same way", () => {
    const [solved] = solveLines([line("a", 0, 0, 6, 10)], [{ kind: "vertical", line: "a" }]);
    expect(solved!.start.x).toBeCloseTo(3, 12);
    expect(solved!.end.x).toBeCloseTo(3, 12);
  });

  it("joins coincident endpoints exactly", () => {
    const solved = solveLines(
      [line("a", 0, 0, 10, 0), line("b", 11, 1, 20, 5)],
      [{ kind: "coincident", lineA: "a", endA: "end", lineB: "b", endB: "start" }],
    );
    expect(solved[0]!.end.x).toBeCloseTo(solved[1]!.start.x, 12);
    expect(solved[0]!.end.y).toBeCloseTo(solved[1]!.start.y, 12);
    // the shared point lands midway between the two original points
    expect(solved[0]!.end.x).toBeCloseTo(10.5, 12);
    expect(solved[0]!.end.y).toBeCloseTo(0.5, 12);
  });

  it("honours a fixed point and moves the rest around it", () => {
    const [solved] = solveLines(
      [line("a", 0, 0, 10, 4)],
      [
        { kind: "fixed", line: "a", at: "start", x: 0, y: 0 },
        { kind: "horizontal", line: "a" },
      ],
    );
    expect(solved!.start).toEqual({ x: 0, y: 0 });
    expect(solved!.end.y).toBeCloseTo(0, 12);
    expect(solved!.end.x).toBeCloseTo(10, 12);
  });

  it("is idempotent: solving an already-satisfied sketch changes nothing", () => {
    const lines = [line("a", 0, 5, 10, 5)];
    const once = solveLines(lines, [{ kind: "horizontal", line: "a" }]);
    const twice = solveLines(once, [{ kind: "horizontal", line: "a" }]);
    expect(twice[0]!.start.y).toBeCloseTo(5, 12);
    expect(twice[0]!.end.y).toBeCloseTo(5, 12);
  });

  it("closes a triangle from two coincident constraints and one fixed corner", () => {
    const lines = [line("a", 0, 0, 10, 0), line("b", 10, 0.4, 5, 8), line("c", 5, 8, -0.2, 0.1)];
    const solved = solveLines(lines, [
      { kind: "fixed", line: "a", at: "start", x: 0, y: 0 },
      { kind: "coincident", lineA: "a", endA: "end", lineB: "b", endB: "start" },
      { kind: "coincident", lineA: "b", endA: "end", lineB: "c", endB: "start" },
      { kind: "coincident", lineA: "c", endA: "end", lineB: "a", endB: "start" },
    ]);
    expect(solved[0]!.start).toEqual({ x: 0, y: 0 });
    expect(solved[0]!.end.x).toBeCloseTo(solved[1]!.start.x, 12);
    expect(solved[1]!.end.x).toBeCloseTo(solved[2]!.start.x, 12);
    expect(solved[2]!.end.x).toBeCloseTo(0, 12);
    expect(solved[2]!.end.y).toBeCloseTo(0, 12);
  });

  it("refuses contradictory constraints by name instead of dividing through", () => {
    expect(() =>
      solveLines(
        [line("a", 0, 0, 10, 0)],
        [
          { kind: "fixed", line: "a", at: "start", x: 0, y: 0 },
          { kind: "fixed", line: "a", at: "start", x: 5, y: 0 },
        ],
      ),
    ).toThrow(ConstraintError);
  });

  it("refuses a constraint on a line that does not exist", () => {
    expect(() => solveLines([line("a", 0, 0, 1, 1)], [{ kind: "horizontal", line: "ghost" }])).toThrow(
      /unknown line "ghost"/,
    );
  });

  it("stays exact where floating point would drift", () => {
    // 0.1 + 0.2 style coordinates must solve to exactly the shared value, not 1e-17 away from it
    const solved = solveLines(
      [line("a", 0.1, 0.2, 0.30000000000000004, 0.7), line("b", 0.3000000000000001, 0.7, 1, 2)],
      [{ kind: "coincident", lineA: "a", endA: "end", lineB: "b", endB: "start" }],
    );
    expect(solved[0]!.end.x).toBe(solved[1]!.start.x);
    expect(solved[0]!.end.y).toBe(solved[1]!.start.y);
  });
});

describe("angular constraints", () => {
  it("refuses to solve an angular constraint as if it were linear, and says where to go instead", () => {
    const lines = [line("a", 0, 0, 10, 0), line("b", 0, 5, 8, 9)];
    expect(() => solveLines(lines, [{ kind: "parallel", lineA: "a", lineB: "b" }])).toThrow(/parallel\(a, b\) is quadratic/);
    expect(() => solveLines(lines, [{ kind: "parallel", lineA: "a", lineB: "b" }])).toThrow(/solveSketch/);
    expect(() => solveLines(lines, [{ kind: "perpendicular", lineA: "a", lineB: "b" }])).toThrow(
      /perpendicular\(a, b\) is quadratic/,
    );
  });

  it("brings a line parallel to a horizontal reference, and lands on it exactly", () => {
    const report = solveSketch(
      [line("a", 0, 0, 10, 0), line("b", 0, 5, 8, 9)],
      [
        { kind: "horizontal", line: "a" },
        { kind: "parallel", lineA: "a", lineB: "b" },
      ],
    );
    const [a, b] = report.lines;
    expect(b!.end.y).toBeCloseTo(b!.start.y, 12);
    expect(b!.start.y).toBe(7);
    expect(a!.start.y).toBe(0);
    expect(report.residual).toBe(0);
    expect(report.exact).toBe(true);
    // and an angle the same solver cannot express in rationals does not get to claim the same thing
    const degrees = solveSketch([line("a", 0, 0, 10, 0), line("b", 0, 0, 10, 6)], [
      { kind: "horizontal", line: "a" },
      { kind: "angle", lineA: "b", lineB: "a", degrees: 45 },
    ]);
    expect(degrees.exact).toBe(false);
  });

  it("rotates lines about their own midpoints instead of sliding them to satisfy an angle", () => {
    const report = solveSketch([line("a", 0, 0, 10, 0), line("b", 0, 5, 8, 9)], [
      { kind: "parallel", lineA: "a", lineB: "b" },
    ]);
    for (const [index, original] of [line("a", 0, 0, 10, 0), line("b", 0, 5, 8, 9)].entries()) {
      const solved = report.lines[index]!;
      expect((solved.start.x + solved.end.x) / 2).toBeCloseTo((original.start.x + original.end.x) / 2, 12);
      expect((solved.start.y + solved.end.y) / 2).toBeCloseTo((original.start.y + original.end.y) / 2, 12);
    }
  });

  it("refuses a constraint that names the same line twice", () => {
    expect(() => solveSketch([line("a", 0, 0, 10, 0)], [{ kind: "parallel", lineA: "a", lineB: "a" }])).toThrow(
      /constrains a line against itself/,
    );
  });

  it("refuses a line with no direction, since an angle to it is undefined", () => {
    expect(() =>
      solveSketch([line("a", 0, 0, 10, 0), line("b", 3, 3, 3, 3)], [{ kind: "parallel", lineA: "a", lineB: "b" }]),
    ).toThrow(/needs a direction.*zero length/);
  });

  it("refuses parallel and perpendicular on the same pair instead of running until the numbers are astronomical", () => {
    // the only configuration satisfying both is a collapsed line, so the two rows fight and the step goes nowhere
    expect(() =>
      solveSketch(
        [line("a", 0, 0, 10, 0), line("b", 0, 5, 8, 5)],
        [
          { kind: "parallel", lineA: "a", lineB: "b" },
          { kind: "perpendicular", lineA: "a", lineB: "b" },
        ],
      ),
    ).toThrow(/cannot be satisfied/);
  });

  it("refuses to call an unconverged sketch solved when it runs out of iterations", () => {
    expect(() =>
      solveSketch([line("a", 0, 0, 10, 0), line("b", 2, 3, 5, 9)], [{ kind: "perpendicular", lineA: "a", lineB: "b" }], {
        maxIterations: 1,
        tolerance: 0,
      }),
    ).toThrow(/did not converge in 1 iterations/);
  });

  it("gives exactly what solveLines gives when there is no angle to satisfy", () => {
    const lines = [line("a", 0, 0, 10, 4), line("b", 10, 4, 20, 4)];
    const constraints = [
      { kind: "coincident" as const, lineA: "a", endA: "end" as const, lineB: "b", endB: "start" as const },
      { kind: "horizontal" as const, line: "b" },
    ];
    const report = solveSketch(lines, constraints);
    expect(report.lines).toEqual(solveLines(lines, constraints));
    expect(report.exact).toBe(true);
    expect(report.residual).toBe(0);
  });

  it("leaves an already-satisfied angular sketch untouched and says it is exact", () => {
    const lines = [line("a", 0, 0, 10, 0), line("b", 0, 5, 8, 5)];
    const report = solveSketch(lines, [{ kind: "parallel", lineA: "a", lineB: "b" }]);
    expect(report.exact).toBe(true);
    expect(report.residual).toBe(0);
    expect(report.lines).toEqual(lines);
  });
});

describe("coordinate representation", () => {
  it("solves coordinates past 1e21, where formatting a double as text switches to exponent notation", () => {
    const big = 1e200;
    const solved = solveLines(
      [line("a", big, big, 2 * big, 2 * big), line("b", 3 * big, 2 * big, 4 * big, 4 * big)],
      [{ kind: "coincident", lineA: "a", endA: "end", lineB: "b", endB: "start" }],
    );
    expect(solved[0]!.end.x).toBe(solved[1]!.start.x);
    expect(solved[0]!.end.y).toBe(solved[1]!.start.y);
    expect(Number.isFinite(solved[0]!.end.x)).toBe(true);
  });

  it("keeps a coordinate smaller than 1e-20 instead of rounding it to the origin", () => {
    const tiny = 1e-30;
    const solved = solveLines(
      [line("a", 0, 0, tiny, tiny), line("b", 3 * tiny, tiny, 4 * tiny, 4 * tiny)],
      [{ kind: "coincident", lineA: "a", endA: "end", lineB: "b", endB: "start" }],
    );
    const shared = solved[0]!.end;
    expect(shared.x).toBeGreaterThan(0);
    expect(Math.abs(shared.x - 2 * tiny) / (2 * tiny)).toBeLessThan(1e-12);
    expect(solved[1]!.start.x).toBe(shared.x);
  });
});

describe("distance and angle", () => {
  const length = (start: { x: number; y: number }, end: { x: number; y: number }) =>
    Math.hypot(end.x - start.x, end.y - start.y);

  it("sets a line's length by growing both ends about the midpoint, like every sketcher does", () => {
    const report = solveSketch([line("a", 0, 0, 3, 4)], [
      { kind: "distance", lineA: "a", endA: "start", lineB: "a", endB: "end", value: 10 },
    ]);
    const [solved] = report.lines;
    // the 3-4-5 triangle scaled to 10, with the midpoint left where it was
    expect(solved!.start.x).toBeCloseTo(-1.5, 9);
    expect(solved!.start.y).toBeCloseTo(-2, 9);
    expect(solved!.end.x).toBeCloseTo(4.5, 9);
    expect(solved!.end.y).toBeCloseTo(6, 9);
    expect(length(solved!.start, solved!.end)).toBeCloseTo(10, 9);
    expect(report.residual).toBeLessThanOrEqual(1e-12);
  });

  it("lands on a length that is already right without moving anything, and says it is exact", () => {
    const report = solveSketch([line("a", 0, 0, 3, 4)], [
      { kind: "distance", lineA: "a", endA: "start", lineB: "a", endB: "end", value: 5 },
    ]);
    expect(report.lines[0]).toEqual(line("a", 0, 0, 3, 4));
    expect(report.exact).toBe(true);
    expect(report.residual).toBe(0);
  });

  it("holds two points a dimension apart without dragging a pinned corner", () => {
    const report = solveSketch(
      [line("a", 0, 0, 10, 0), line("b", 3, 4, 9, 4)],
      [
        { kind: "fixed", line: "a", at: "start", x: 0, y: 0 },
        { kind: "distance", lineA: "a", endA: "start", lineB: "b", endB: "start", value: 10 },
      ],
    );
    const [a, b] = report.lines;
    expect(a!.start.x).toBeCloseTo(0, 12);
    expect(a!.start.y).toBeCloseTo(0, 12);
    expect(length(a!.start, b!.start)).toBeCloseTo(10, 9);
    // the correction goes into the free point, along the line it already sat on: 3-4-5 scaled to 10
    expect(b!.start.x).toBeCloseTo(6, 9);
    expect(b!.start.y).toBeCloseTo(8, 9);
  });

  it("sets an angle between two lines, and cannot claim exactness because cos 45° is not rational", () => {
    const report = solveSketch(
      [line("a", 0, 0, 10, 0), line("b", 0, 0, 10, 1)],
      [
        { kind: "horizontal", line: "a" },
        { kind: "angle", lineA: "b", lineB: "a", degrees: 45 },
      ],
    );
    const [a, b] = report.lines;
    expect(a!.end.y).toBeCloseTo(0, 12);
    const radians = Math.atan2(b!.end.y - b!.start.y, b!.end.x - b!.start.x);
    expect((Math.abs(radians) * 180) / Math.PI).toBeCloseTo(45, 9);
    expect(report.residual).toBeLessThanOrEqual(1e-12);
    // honest: the target is the double nearest cos 45°, which is not a rational the geometry can land on exactly
    expect(report.exact).toBe(false);
  });

  it("squares a corner with angle 90 the way perpendicular does, and the two agree", () => {
    const byAngle = solveSketch([line("a", 0, 0, 10, 0), line("b", 0, 0, 10, 1)], [
      { kind: "horizontal", line: "a" },
      { kind: "angle", lineA: "b", lineB: "a", degrees: 90 },
    ]);
    const byPerpendicular = solveSketch([line("a", 0, 0, 10, 0), line("b", 0, 0, 10, 1)], [
      { kind: "horizontal", line: "a" },
      { kind: "perpendicular", lineA: "b", lineB: "a" },
    ]);
    expect(byAngle.lines[1]!.end.x).toBeCloseTo(byPerpendicular.lines[1]!.end.x, 9);
    expect(byAngle.lines[1]!.end.y).toBeCloseTo(byPerpendicular.lines[1]!.end.y, 9);
  });

  it("measures the residual in a way that does not change when the sketch is drawn in millimetres", () => {
    const sketch = (scale: number) => [
      line("a", 0, 0, 3 * scale, 4 * scale),
      line("b", 0, 0, 10 * scale, 0),
    ];
    const constraints = (scale: number): Constraint[] => [
      { kind: "distance", lineA: "a", endA: "end", lineB: "b", endB: "end", value: 3 * scale },
      { kind: "angle", lineA: "a", lineB: "b", degrees: 37 },
    ];
    const metric = solveSketch(sketch(1), constraints(1));
    const millimetres = solveSketch(sketch(1000), constraints(1000));
    // one tolerance has to mean the same thing at both scales, so the reported error is dimensionless
    expect(Math.abs(metric.residual - millimetres.residual)).toBeLessThan(1e-6);
  });

  it("refuses a distance of zero or less, pointing at the constraint that means it", () => {
    const lines = [line("a", 0, 0, 3, 4)];
    const at = (value: number) =>
      () =>
        solveSketch(lines, [{ kind: "distance", lineA: "a", endA: "start", lineB: "a", endB: "end", value }]);
    expect(at(0)).toThrow(/positive length/);
    expect(at(-5)).toThrow(/positive length/);
  });

  it("refuses a distance between a point and itself", () => {
    const lines = [line("a", 0, 0, 3, 4)];
    expect(() =>
      solveSketch(lines, [{ kind: "distance", lineA: "a", endA: "end", lineB: "a", endB: "end", value: 4 }]),
    ).toThrow(/point and itself/);
  });

  it("refuses the angles that already have their own names", () => {
    const lines = [line("a", 0, 0, 3, 4), line("b", 1, 0, 4, 5)];
    for (const degrees of [0, 180, -30]) {
      expect(() => solveSketch(lines, [{ kind: "angle", lineA: "a", lineB: "b", degrees }])).toThrow(
        /between 0 and 180 degrees/,
      );
    }
  });

  it("refuses an angle between a line and itself", () => {
    const lines = [line("a", 0, 0, 3, 4)];
    expect(() => solveSketch(lines, [{ kind: "angle", lineA: "a", lineB: "a", degrees: 30 }])).toThrow(
      /against itself/,
    );
  });

  it("refuses a tangent that names a line where an arc belongs", () => {
    const lines = [line("a", 0, 0, 3, 4), line("b", 1, 0, 4, 5)];
    expect(() => solveSketch(lines, [{ kind: "tangent", line: "a", arc: "b" }])).toThrow(/unknown arc "b"/);
  });

  it("refuses a tangent to an arc with no radius, because a point has no tangent", () => {
    const lines = [line("a", -10, 0, 10, 0)];
    const arcs = [{ kind: "arc" as const, id: "c", centre: { x: 0, y: 8 }, radius: 0 }];
    expect(() => solveSketch(lines, [{ kind: "tangent", line: "a", arc: "c" }], { arcs })).toThrow(
      /positive radius/,
    );
  });

  it("refuses a tangent when the line has no direction to be tangent along", () => {
    const lines = [line("a", 4, 4, 4, 4)];
    const arcs = [{ kind: "arc" as const, id: "c", centre: { x: 0, y: 0 }, radius: 2 }];
    expect(() => solveSketch(lines, [{ kind: "tangent", line: "a", arc: "c" }], { arcs })).toThrow(/zero length/);
  });

  it("moves the arc's centre until the line is its tangent, and leaves the radius alone", () => {
    // the line is pinned along y = 0, so the radius-5 arc at (3, 12) is the thing that has to move: down to y = 5
    const lines = [line("wall", -20, 0, 20, 0)];
    const constraints: Constraint[] = [
      { kind: "fixed", line: "wall", at: "start", x: -20, y: 0 },
      { kind: "fixed", line: "wall", at: "end", x: 20, y: 0 },
      { kind: "tangent", line: "wall", arc: "c" },
    ];
    const arcs = [{ kind: "arc" as const, id: "c", centre: { x: 3, y: 12 }, radius: 5 }];
    const report = solveSketch(lines, constraints, { arcs });
    const solved = report.arcs![0]!;
    expect(solved.id).toBe("c");
    expect(solved.radius).toBe(5);
    expect(solved.centre.x).toBeCloseTo(3, 10);
    expect(solved.centre.y).toBeCloseTo(5, 10);
    expect(report.residual).toBeLessThanOrEqual(1e-12);
    // the pin is not in dispute: tangency may not buy itself a moved endpoint
    expect(report.lines[0]!.start).toEqual({ x: -20, y: 0 });
    expect(report.lines[0]!.end).toEqual({ x: 20, y: 0 });
    // and the tangency, measured independently of the solver's own arithmetic: the perpendicular distance is the radius
    const wall = report.lines[0]!;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const offsetX = solved.centre.x - wall.start.x;
    const offsetY = solved.centre.y - wall.start.y;
    expect(Math.abs(dx * offsetY - dy * offsetX) / Math.hypot(dx, dy)).toBeCloseTo(5, 10);
  });

  it("leaves the line touching the arc at one point, checked by closed-form intersections rather than by the solver", () => {
    // sketch.ts solves line/arc intersections in closed form, with no code in common with the solver. A tangent line meets
    // the circle at a double root, and a double root splits into two roots about 1e-7 apart in doubles when the line is
    // off by 1e-14, so "one point" is checked as "the two roots coincide", not as "the solver said so"
    const lines = [line("wall", -20, 3, 20, 3)];
    const constraints: Constraint[] = [
      { kind: "horizontal", line: "wall" },
      { kind: "fixedArc", arc: "c", x: 0, y: 0 },
      { kind: "tangent", line: "wall", arc: "c" },
    ];
    const arcs = [{ kind: "arc" as const, id: "c", centre: { x: 0, y: 0 }, radius: 7, start: 0, end: Math.PI * 2 }];
    const report = solveSketch(lines, constraints, { arcs });
    const wall = report.lines[0]!;
    const circle = report.arcs![0]!;
    const crossings = lineArcIntersections(
      { kind: "line", a: wall.start, b: wall.end },
      { kind: "arc", centre: circle.centre, radius: circle.radius, start: circle.start!, end: circle.end! },
    );
    expect(crossings.length).toBeGreaterThan(0);
    expect(crossings.length).toBeLessThanOrEqual(2);
    const spread = Math.hypot(crossings[0]!.x - crossings.at(-1)!.x, crossings[0]!.y - crossings.at(-1)!.y);
    expect(spread).toBeLessThan(1e-5);
    for (const crossing of crossings) {
      expect(Math.hypot(crossing.x, crossing.y)).toBeCloseTo(7, 7);
    }
  });

  it("holds two arcs tangent to the same line at once", () => {
    const lines = [line("rail", -50, 0, 50, 0)];
    const constraints: Constraint[] = [
      { kind: "fixed", line: "rail", at: "start", x: -50, y: 0 },
      { kind: "fixed", line: "rail", at: "end", x: 50, y: 0 },
      { kind: "tangent", line: "rail", arc: "small" },
      { kind: "tangent", line: "rail", arc: "large" },
    ];
    const arcs = [
      { kind: "arc" as const, id: "small", centre: { x: -20, y: 9 }, radius: 2, start: 0, end: Math.PI * 2 },
      { kind: "arc" as const, id: "large", centre: { x: 20, y: -14 }, radius: 6, start: 0, end: Math.PI * 2 },
    ];
    const report = solveSketch(lines, constraints, { arcs });
    const [small, large] = report.arcs!;
    expect(small!.centre.y).toBeCloseTo(2, 9);
    expect(large!.centre.y).toBeCloseTo(-6, 9);
    expect(report.residual).toBeLessThanOrEqual(1e-12);
  });

  it("reports a sketch that is already tangent as exact and does not move it", () => {
    const lines = [
      line("wall", -20, 0, 20, 0),
    ];
    const constraints: Constraint[] = [
      { kind: "fixed", line: "wall", at: "start", x: -20, y: 0 },
      { kind: "fixed", line: "wall", at: "end", x: 20, y: 0 },
    ];
    const arcs = [{ kind: "arc" as const, id: "c", centre: { x: 3, y: -5 }, radius: 5 }];
    const report = solveSketch(lines, [...constraints, { kind: "tangent", line: "wall", arc: "c" }], { arcs });
    expect(report.exact).toBe(true);
    expect(report.residual).toBe(0);
    expect(report.arcs![0]!.centre).toEqual({ x: 3, y: -5 });
  });

  it("moves the line when the arc is pinned instead, and keeps its ends level", () => {
    // the same sketch with the two roles swapped: fixedArc holds the centre, and the line slides to y = 5
    const lines = [line("wall", -20, 10, 20, 10)];
    const constraints: Constraint[] = [
      { kind: "horizontal", line: "wall" },
      { kind: "fixedArc", arc: "c", x: 0, y: 15 },
      { kind: "tangent", line: "wall", arc: "c" },
    ];
    const arcs = [{ kind: "arc" as const, id: "c", centre: { x: 0, y: 15 }, radius: 10 }];
    const report = solveSketch(lines, constraints, { arcs });
    const [wall] = report.lines;
    expect(wall!.start.y).toBeCloseTo(5, 10);
    expect(wall!.end.y).toBeCloseTo(5, 10);
    expect(report.arcs![0]!.centre).toEqual({ x: 0, y: 15 });
    // the line slid rather than growing: its length is the one it was drawn with
    expect(Math.abs(wall!.end.x - wall!.start.x)).toBeCloseTo(40, 10);
  });

  it("keeps distance and angle out of solveLines, which only claims the linear ones", () => {
    const lines = [line("a", 0, 0, 3, 4), line("b", 1, 0, 4, 5)];
    expect(() =>
      solveLines(lines, [{ kind: "distance", lineA: "a", endA: "start", lineB: "b", endB: "end", value: 2 }]),
    ).toThrow(/quadratic, not linear/);
    expect(() => solveLines(lines, [{ kind: "angle", lineA: "a", lineB: "b", degrees: 30 }])).toThrow(
      /quadratic, not linear/,
    );
  });
});
