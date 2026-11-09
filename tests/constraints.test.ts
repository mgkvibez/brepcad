import { describe, expect, it } from "vitest";

import { ConstraintError, solveLines, type LineEntity } from "../src/constraints.js";

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
