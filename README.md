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
one step and the answer is exact in rationals. `parallel`, `perpendicular`, `angle` and `distance` are quadratic, and
`solveLines` refuses them by name rather than pretending otherwise.

`solveSketch` takes the quadratic ones: it solves the linear rows exactly, then iterates the quadratic constraints, each
step linearising them about the current configuration and solving that exactly in rationals. The report says which kind
of answer came out. `exact` is true only when the equations hold in rationals at the geometry returned, not merely
within tolerance: `parallel` against a horizontal reference lands with both y values at exactly `7`, so `exact: true` and
`residual: 0`, while an `angle` of 45° cannot be exact because `cos 45°` is irrational, so it reports `exact: false` and a
residual of `7.8e-13`. A caller that needs a square edge reads `residual`; a caller that needs proof reads `exact`.

`distance` takes two endpoints and a positive length, which is the dimension a sketch is really drawn with: the 3-4-5
triangle asked for a length of 10 grows symmetrically about its midpoint to `(-1.5, -2)-(4.5, 6)`. `angle` takes a
target in degrees and picks the side the sketch is already drawn on, so it makes the small correction instead of swinging
the line round to the mirror answer; swapping the line's endpoints asks for the other side.

Three things the iteration needed, each found by testing rather than by design. An angular equation is homogeneous of
degree two, so a step along its gradient always shrinks the sketch, and `u = 0` satisfies it exactly: measured on
`angle = 45°` over a 10-long horizontal and an 11.7-long line at 31°, the residual fell 113 → 27.9 and then both lines
were half their length and the next steps ran past every bound. The fix is to project each step back onto "this line's
length does not change", which leaves a rotation about the endpoints' midpoint, and to skip that for a length a
`distance` constraint already fixes. Separately, an exact rational target such as `cos 45°` has a 53-bit denominator that
every step multiplies through, so by the third step the coordinates were ~10 in value with numerators past 2^256; each
step is now re-anchored to the doubles the caller will actually receive, which is what the API returns anyway.

### Tangency, which is what made arcs solver unknowns

`tangent(line, arc)` works, and it is the reason arcs entered the solver at all. An arc contributes its centre as two
unknowns, and its radius is a given: "make this tangent" is a statement about position, so a tangency allowed to resize
the arc would satisfy itself by shrinking it. The equation is `det(d, c - p)² - r²|d|² = 0`, the squared form because the
unsquared perpendicular distance is not polynomial and would break the exact arithmetic, with `d` the line's direction,
`p` its start and `c` the centre.

Two things about it are worth naming because they are where a naive version goes wrong:

1. The `-2r²|d|²` term is not decoration. Without it the gradient only ever asks for "move until the perpendicular
   distance is `r`", and a line collapsed to a point satisfies that for every arc. The term resists the collapse, and the
   length gauge below keeps the line the length it was drawn.
2. A pin outranks a gauge. The length gauge works by moving one end up and the other down by the same amount, which is
   invisible on a free line and a broken constraint on a pinned one: measured on `tangent(wall, c)` with both ends of the
   wall fixed, the solve moved the arc correctly and then shifted the wall's endpoints by ±0.0104 to restore its length,
   putting two pinned points off their pins. The gauge now skips any line with a pinned coordinate, and `fixedArc` pins an
   arc centre so the line is the thing that moves when that is what the user meant.

Two refusals came with it, both named rather than approximated: an arc id that names a line, and an arc with no radius,
because a point has no tangent to be on.

Two things are still refused by name. A set that cannot hold together: `parallel` and `perpendicular` over the same pair
have no solution except a collapsed line, the two rows fight, the step stops moving, and the refusal names the
constraints instead of running until the rationals are astronomical. And a failure to converge inside the iteration
budget is an error, not a sketch that looks approximately square.

## Status

**Stages 0 and 1: geometry and constraints.** Exact 2D sketch geometry with tests: line/line and line/arc intersection,
arc sweep handling including full turns, signed area by the shoelace rule with exact circular segments, and bounding
boxes that account for the axis crossings an arc sweeps through. On top of it, the constrained-geometry layer described
above. There is no extruder, no B-rep topology and no kernel integration yet.

**Tests:** 51

```bash
npm ci && npm run verify
```

## Roadmap

1. **Sketch geometry** (done): exact primitives, intersections, area, bounds.
2. **Constraint solver** (partly done): horizontal, vertical, coincident and fixed solve exactly; parallel,
   perpendicular, angle and distance iterate with a reported residual that is exact when it can be. Tangent, arcs as
   solver unknowns, and named under-/over-constrained reporting are still missing.
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
