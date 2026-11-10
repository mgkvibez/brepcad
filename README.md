# brepcad

**Parametric B-rep modelling in the browser.**

Onshape has no open rival. The kernel half of the problem is solved by OpenCascade compiled to WASM. The unsolved half is
what sits on top: a history tree of features, each of which rebuilds deterministically when an earlier dimension changes.

## Why the sketch layer comes first

Every feature in a history-based modeller is built on a sketch, and every sketch is constrained geometry. Fillet, extrude,
revolve and loft all ask the same questions: where do these curves meet, is the profile closed, how much area does it
enclose, which side is material.

Those answers must be **analytic**. A kernel that approximates a circle with line segments produces fillets that are subtly
wrong and exports that cannot be machined. So arcs stay arcs, and intersections are solved in closed form.

## Constraints

`solveLines` moves a sketch the least amount that satisfies its constraints, which is the linear-algebra question every
sketch tool really asks: minimise displacement subject to `A u = b`, solved here by substituting out the constraints and
solving `A Aᵀ λ = b - A u0` over exact BigInt fractions, converting back once at the end.

`horizontal`, `vertical`, `coincident` and `fixed` are exactly linear in the coordinates, so `solveLines` solves them in
one step and the answer is exact in rationals. `parallel` and `perpendicular` are quadratic, and `solveLines` refuses
them by name rather than pretending otherwise.

`solveSketch` takes the angular ones: it solves the linear rows exactly, then projects the angular constraints, each
step linearising them about the current configuration and solving that exactly in rationals. The report says which kind
of answer came out. `exact` is true only when the equations hold in rationals, not merely within tolerance, and Newton
on a quadratic closes on the root without ever landing on it: fresh geometry measured between `1e-33` and `1e-14` of
relative error with `exact: false`, while re-solving geometry that already satisfies the constraints reports
`exact: true` without moving anything. A caller that needs a square edge reads `angularResidual`; a caller that needs
proof reads `exact`.

Three things are refused by name instead of approximated. An unknown constraint kind, including `tangent`, is rejected
rather than skipped. So is a set that cannot hold together: `parallel` and `perpendicular` over the same pair have no
solution except a collapsed line, so the iterate diverges, and a magnitude bound stops it and names the constraints
instead of running until the rationals are astronomical. And a failure to converge inside the iteration budget is an
error, not a sketch that looks approximately square.

## Status

**Stages 0 and 1: geometry and constraints.** Exact 2D sketch geometry with tests: line/line and line/arc intersection,
arc sweep handling including full turns, signed area by the shoelace rule with exact circular segments, and bounding
boxes that account for the axis crossings an arc sweeps through. On top of it, the constrained-geometry layer described
above. There is no extruder, no B-rep topology and no kernel integration yet.

**Tests:** 33

```bash
npm ci && npm run verify
```

## Roadmap

1. **Sketch geometry** (done): exact primitives, intersections, area, bounds.
2. **Constraint solver** (partly done): horizontal, vertical, coincident and fixed solve exactly; parallel and
   perpendicular iterate with a reported residual. Tangent, distance and angle constraints, and named
   under-/over-constrained reporting, are still missing.
3. **Profiles**: detect closed regions, classify outer boundary against holes by orientation.
4. **Extrude/revolve** onto a B-rep body with stable face identifiers so features can re-find their references.
5. **History rebuild**: every feature re-evaluated in order, with a topological naming strategy that survives an earlier
   dimension change. This is the part that makes or breaks the product.
6. **Kernel**: OpenCascade via WASM, behind our own interface so it can be replaced.

## Non-goals

- Not a mesh modeller. Triangles are an export format, not the model.
- No cloud collaboration in the first year.
- No importing proprietary files before the kernel round-trips its own.

## Licence

MIT.
