import { useMemo } from 'react'
import type { StageMode } from '@bygga/engine/stage'
import { buildBissaPlan } from '../lib/bissaPlan'
import { lookupBissaPart, resolveHwRef } from '../lib/bissaParts'
import { stagePlaybackSpeed } from '../lib/stageMotion'
import { framingFor } from '../lib/stepFraming'
import { lastStepFor, planStepCount } from '../lib/stepMap'
import type { ProductVariant, VisualState } from '../lib/types'
import { visualModeLabel } from '../lib/visualMode'
import StageView from './StageView'

type Props = {
  visual: VisualState
  variant: ProductVariant
  stepKey: string
  compact?: boolean
  /** Bubble embeds: smaller, non-interactive, no meta footer. */
  embed?: 'sticky' | 'bubble'
}

export default function VisualPanel({
  visual,
  variant,
  stepKey,
  compact,
  embed = 'sticky',
}: Props) {
  const isBubble = embed === 'bubble'
  const plan = useMemo(() => buildBissaPlan(variant), [variant])
  const max = lastStepFor(variant)
  const planMax = planStepCount(variant)
  const hasStepArt = visual.bygga_step != null && visual.bygga_step >= 1
  const isGap = visual.visual_mode === 'step' && visual.fidelity === 'gap'
  const vMode = visual.visual_mode
  const partInfo = lookupBissaPart(visual.missing_part_id)
  const hwRef = useMemo(
    () => resolveHwRef(plan, visual.missing_part_id),
    [plan, visual.missing_part_id],
  )

  const frame = framingFor(variant, visual.focus_step ?? visual.bygga_step)
  const mode: StageMode = (() => {
    // Named fitting / missing screw → solo hardware hero (or layout if unknown).
    if ((vMode === 'part' || (vMode === 'parts_overview' && hwRef)) && hwRef) {
      return {
        kind: 'part',
        ref: hwRef,
        label: visual.missing_part_id ?? hwRef,
        title: partInfo?.name,
      }
    }
    if (vMode === 'parts_overview' || vMode === 'part') return { kind: 'layout' }
    if (vMode === 'assembled') return { kind: 'assembled', turntable: false, dims: !compact }
    if (vMode === 'step' && hasStepArt) {
      return {
        kind: 'step',
        index: (visual.bygga_step as number) - 1,
        view: { az: frame.az, el: frame.el },
        tight: frame.tight,
      }
    }
    if (hasStepArt) {
      return {
        kind: 'step',
        index: (visual.bygga_step as number) - 1,
        view: { az: frame.az, el: frame.el },
        tight: frame.tight,
      }
    }
    return { kind: 'assembled', turntable: false, dims: !compact }
  })()

  const gap =
    vMode === 'step' &&
    (isGap || visual.holding_prior || (visual.focus_step != null && visual.bygga_step == null))

  return (
    <section
      className={`visual ${compact || isBubble ? 'visual--compact' : ''} ${isBubble ? 'visual--bubble' : ''}`}
      aria-label="Assembly visual"
    >
      <div className={`visual-stage ${stepKey}`}>
        {/* Stable Stage host — mode updates via setMode; remount only when parent key changes (IC-29). */}
        <StageView
          plan={plan}
          mode={mode}
          speed={stagePlaybackSpeed}
          options={{
            labels: isBubble
              ? false
              : !compact || vMode === 'parts_overview' || vMode === 'part',
            callout: !isBubble && !compact && vMode === 'step',
            // Sticky: drag orbit.
            interactive: !isBubble,
            speed: stagePlaybackSpeed,
            loop: false,
          }}
        />
        {!isBubble && gap && visual.focus_step != null && (
          <div className="visual-gap" role="status">
            <p>{isGap ? 'No 3D geometry for this beat' : 'No dedicated 3D beat'}</p>
            <span>
              {isGap ? 'Placeholder' : 'Holding prior stage'}
              {visual.manual_page != null ? ` · Manual p. ${visual.manual_page}` : ''}
            </span>
          </div>
        )}
        {!isBubble && vMode === 'idle' && visual.focus_step == null && !visual.product_variant && (
          <div className="visual-gap visual-gap--idle" role="status">
            <p>Ask about a step or part to begin</p>
          </div>
        )}
      </div>

      {/* Compact help UI: drop Assembled/Step/Manual/Stage debug pills — Expand 3D lives in the rail head. */}
      {!compact && !isBubble ? (
        <footer className="visual-meta">
          <div>
            <strong>
              {vMode === 'step'
                ? `${visual.focus_mode === 'preview' ? 'Preview' : 'Step'} ${visual.focus_step ?? '—'}`
                : vMode === 'part' && partInfo
                  ? partInfo.name
                  : visualModeLabel(vMode)}
              {vMode === 'step' && <span className="muted"> / {max}</span>}
            </strong>
            {vMode !== 'part' && <span className="chip chip--map">{visualModeLabel(vMode)}</span>}
            {vMode === 'part' && <span className="chip chip--map">Part focus</span>}
            {vMode === 'step' && visual.manual_page != null && (
              <span className="chip">Manual p. {visual.manual_page}</span>
            )}
            {vMode === 'step' && visual.bygga_step != null && (
              <span className="chip chip--map">
                Stage {visual.bygga_step}/{planMax}
              </span>
            )}
            {vMode === 'step' && visual.fidelity ? (
              <span className="chip chip--faint">{visual.fidelity}</span>
            ) : null}
          </div>
          <div className="visual-flags">
            {visual.wall_anchored && <span className="flag">Wall anchored</span>}
            {visual.missing_part_id && (
              <span className="flag flag--warn">
                Part {visual.missing_part_id}
                {partInfo ? ` · ${partInfo.name}` : ''}
              </span>
            )}
          </div>
        </footer>
      ) : null}
    </section>
  )
}
