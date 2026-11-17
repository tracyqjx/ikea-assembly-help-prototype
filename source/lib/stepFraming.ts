import framingJson from '../data/bissa-step-framing.json'
import type { ProductVariant } from './types'

export type StepFrame = {
  az: number
  el: number
  tight: number
  cue?: string
}

type FramingFile = {
  version: number
  defaults: { az: number; el: number; tight: number }
  '2_compartments': Record<string, StepFrame>
  '3_compartments': Record<string, StepFrame>
}

const framing = framingJson as FramingFile

/** PDF-manual camera cue for a Flowstore/PDF step (1-based). */
export function framingFor(variant: ProductVariant, pdfStep: number | null | undefined): StepFrame {
  const d = framing.defaults
  if (pdfStep == null) return { az: d.az, el: d.el, tight: d.tight ?? 1.35 }
  const hit = framing[variant][String(pdfStep)]
  if (!hit) return { az: d.az, el: d.el, tight: d.tight ?? 1.35 }
  return {
    az: hit.az,
    el: hit.el,
    tight: hit.tight ?? d.tight ?? 1.35,
    cue: hit.cue,
  }
}
