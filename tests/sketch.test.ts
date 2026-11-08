import { describe, expect, it } from "vitest";

import { angleOnArc, boundingBox, lineArcIntersections, lineLineIntersection, normaliseAngle, profileArea, vec } from "../src/sketch.js";

const line = (ax: number, ay: number, bx: number, by: number) => ({ kind: "line" as const, a: vec(ax, ay), b: vec(bx, by) });

describe("sketch geometry", () => {
  it("intersects two lines exactly", () => {
    const point = lineLineIntersection(line(0, 0, 10, 10), line(0, 10, 10, 0));
    expect(point?.x).toBeCloseTo(5, 12);
    expect(point?.y).toBeCloseTo(5, 12);
  });

  it("returns null for parallel lines instead of infinity", () => {
    expect(lineLineIntersection(line(0, 0, 10, 0), line(0, 5, 10, 5))).toBeNull();
  });

  it("intersects a line through a circle at two points", () => {
    const arc = { kind: "arc" as const, centre: vec(0, 0), radius: 5, start: 0, end: Math.PI * 2 };
    const hits = lineArcIntersections(line(-10, 0, 10, 0), arc);
    expect(hits).toHaveLength(2);
    expect(hits.map((p) => Math.round(p.x)).sort((a, b) => a - b)).toEqual([-5, 5]);
  });

  it("filters intersections outside the arc's sweep", () => {
    // A quarter arc: the hit at angle 0 is on it, the hit at angle pi is not.
    const quarter = { kind: "arc" as const, centre: vec(0, 0), radius: 5, start: 0, end: Math.PI / 2 };
    expect(lineArcIntersections(line(-10, 0, 10, 0), quarter).map((p) => Math.round(p.x))).toEqual([5]);
  });

  it("treats both endpoints as part of the arc", () => {
    const half = { kind: "arc" as const, centre: vec(0, 0), radius: 5, start: 0, end: Math.PI };
    expect(lineArcIntersections(line(-10, 0, 10, 0), half).map((p) => Math.round(p.x)).sort((a, b) => a - b)).toEqual([-5, 5]);
  });

  it("wraps angles into [0, 2pi)", () => {
    expect(normaliseAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12);
  });

  it("knows which angles lie on an arc", () => {
    const arc = { kind: "arc" as const, centre: vec(0, 0), radius: 1, start: Math.PI / 2, end: Math.PI };
    expect(angleOnArc(arc, Math.PI * 0.75)).toBe(true);
    expect(angleOnArc(arc, 0)).toBe(false);
  });

  it("measures a closed square exactly", () => {
    const square = [line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 0)];
    expect(profileArea(square)).toBeCloseTo(100, 12);
  });

  it("measures a full circle exactly, not as polygons", () => {
    const circle = [{ kind: "arc" as const, centre: vec(0, 0), radius: 2, start: 0, end: Math.PI * 2 }];
    expect(profileArea(circle)).toBeCloseTo(Math.PI * 4, 10);
  });

  it("bounding box of an arc includes the axis crossing it sweeps through", () => {
    const quarter = { kind: "arc" as const, centre: vec(0, 0), radius: 5, start: 0, end: Math.PI / 2 };
    const box = boundingBox([quarter]);
    expect(box.min.x).toBeCloseTo(0, 10);
    expect(box.max.y).toBeCloseTo(5, 10);
  });

  it("refuses an empty sketch rather than returning an infinite box", () => {
    expect(() => boundingBox([])).toThrow(RangeError);
  });
});
