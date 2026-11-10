import { describe, expect, it } from "vitest";

import { ConstraintError, solveLines, solveSketch, type LineEntity } from "../src/constraints.js";

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
    expect(() => solveLines(lines, [{ kind: "parallel", lineA: "a", lineB: "b" }])).toThrow(/parallel\(a, b\) is angular/);
    expect(() => solveLines(lines, [{ kind: "parallel", lineA: "a", lineB: "b" }])).toThrow(/solveSketch/);
    expect(() => solveLines(lines, [{ kind: "perpendicular", lineA: "a", lineB: "b" }])).toThrow(
      /perpendicular\(a, b\) is angular/,
    );
  });

  it("brings a line parallel to a horizontal reference, and reports the error rather than claiming exactness", () => {
    const report = solveSketch(
      [line("a", 0, 0, 10, 0), line("b", 0, 5, 8, 9)],
      [
        { kind: "horizontal", line: "a" },
        { kind: "parallel", lineA: "a", lineB: "b" },
      ],
    );
    const [a, b] = report.lines;
    expect(b!.end.y).toBeCloseTo(b!.start.y, 12);
    expect(report.angularResidual).toBeLessThanOrEqual(1e-12);
    expect(report.iterations).toBeGreaterThanOrEqual(1);
    // Newton closes on the root without landing on it in exact arithmetic, and the report must not pretend otherwise
    expect(report.exact).toBe(false);
    expect(a!.start.y).toBe(0);
    expect(a!.end.y).toBe(0);
  });

  it("brings a line perpendicular to a horizontal reference, which is what a square corner is", () => {
    const report = solveSketch(
      [line("a", 0, 0, 10, 0), line("b", 2, 3, 5, 9)],
      [
        { kind: "horizontal", line: "a" },
        { kind: "perpendicular", lineA: "a", lineB: "b" },
      ],
    );
    const [, b] = report.lines;
    expect(b!.end.x).toBeCloseTo(b!.start.x, 12);
    expect(report.angularResidual).toBeLessThanOrEqual(1e-12);
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
    // the only configuration satisfying both is a collapsed line, so the iterate diverges; this used to hang
    expect(() =>
      solveSketch(
        [line("a", 0, 0, 10, 0), line("b", 0, 5, 8, 5)],
        [
          { kind: "parallel", lineA: "a", lineB: "b" },
          { kind: "perpendicular", lineA: "a", lineB: "b" },
        ],
      ),
    ).toThrow(/cannot all be satisfied/);
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
    expect(report.angularResidual).toBe(0);
  });

  it("leaves an already-satisfied angular sketch untouched and says it is exact", () => {
    const lines = [line("a", 0, 0, 10, 0), line("b", 0, 5, 8, 5)];
    const report = solveSketch(lines, [{ kind: "parallel", lineA: "a", lineB: "b" }]);
    expect(report.exact).toBe(true);
    expect(report.angularResidual).toBe(0);
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
