# Bygga attribution

This folder vendors a minimal subset of [Nutlope/bygga](https://github.com/Nutlope/bygga) (MIT):

- `engine/` — Three.js line-art stage
- `lib/plan/{builder,custom,math}.ts` — plan builder
- `lib/plan/families/bissa.ts` — BISSA parametric recipe (**adapted**: expanded from upstream’s 15 collapsed steps to 23/24 PDF-aligned stage indices for this demo)
- `lib/types.ts`, `stage.css`

**Demo motion:** stage/builder durations and staggers are lengthened (~1.7×); playback also uses `STAGE_MOTION_SCALE` from `demo/src/lib/stageMotion.ts` (default **2** → speed 0.5) so pose, inserts, hardware, and camera share one eased clock. Tune that constant (about 1.5–2.5).

See `LICENSE` and `NOTICE`. Not affiliated with IKEA. No runtime dependency on usebygga.com.
