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

Supported today: `horizontal`, `vertical`, `coincident`, `fixed`. Each is linear in the coordinates, so each is exact.
Parallel, perpendicular and tangency are **not** supported, and are refused by name rather than linearised, because a
linearised approximation is precisely the silent inaccuracy this project exists to avoid. Contradictory constraints are
refused by name instead of divided through.

## Status

**Stage 0: scaffolding.** Exact 2D sketch geometry with tests: line/line and line/arc intersection, arc sweep handling
including full turns, signed area by the shoelace rule with exact circular segments, and bounding boxes that account for
the axis crossings an arc sweeps through. There is no constraint solver, no extruder, no B-rep topology and no kernel
integration yet.

**Tests:** 21

```bash
npm ci && npm run verify
```

## Roadmap

1. **Sketch geometry** (done): exact primitives, intersections, area, bounds.
2. **Constraint solver**: coincident, parallel, perpendicular, tangent, distance, angle; solver reports under- and
   over-constrained sketches by name.
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
