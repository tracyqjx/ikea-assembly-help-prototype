/**
 * Demo motion pacing for the vendored Bygga stage.
 *
 * `STAGE_MOTION_SCALE` ≈ how much longer motions feel vs upstream Bygga
 * (1 = stock, 2 ≈ twice as long). Useful range for class demo: 1.5 – 2.5.
 *
 * Playback uses `stagePlaybackSpeed = 1 / scale` so pose, inserts, hardware,
 * and camera all share one clock (see Stage.tick).
 */
export const STAGE_MOTION_SCALE = 2

export const stagePlaybackSpeed = 1 / STAGE_MOTION_SCALE
