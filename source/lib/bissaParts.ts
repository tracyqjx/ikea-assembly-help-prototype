import type { HwKind, Plan } from '@bygga/lib/types'
import type { ProductVariant } from './types'

/** Match criteria against Bygga `plan.hardware` entries. */
export type HwMatch = {
  kind: HwKind
  len?: number
  dia?: number
  /** Prefer types whose name contains this (case-insensitive). */
  nameIncludes?: string
}

export type BissaPartInfo = {
  part_id: string
  name: string
  match: HwMatch
  qty: Record<ProductVariant, number>
}

/**
 * Official BISSA fittings (`bissa_parts` in the Flowstore spec) → Bygga geometry.
 * Dims follow the vendored BISSA recipe (wall screw 60×5, bushing spacer, etc.).
 */
export const BISSA_PARTS: BissaPartInfo[] = [
  {
    part_id: '118331',
    name: 'Wooden dowel',
    match: { kind: 'dowel' },
    qty: { '2_compartments': 10, '3_compartments': 10 },
  },
  {
    part_id: '118224',
    name: 'Cam bolt',
    match: { kind: 'camScrew' },
    qty: { '2_compartments': 10, '3_compartments': 10 },
  },
  {
    part_id: '101350',
    name: 'Cam lock',
    match: { kind: 'cam' },
    qty: { '2_compartments': 10, '3_compartments': 10 },
  },
  {
    part_id: '107849',
    name: 'Pivot fitting',
    match: { kind: 'hook', nameIncludes: 'pivot' },
    qty: { '2_compartments': 4, '3_compartments': 4 },
  },
  {
    part_id: '109535',
    name: 'Screw',
    match: { kind: 'screw', len: 12, dia: 3 },
    qty: { '2_compartments': 12, '3_compartments': 18 },
  },
  {
    part_id: '10095065',
    name: 'Tip-out bracket screw',
    match: { kind: 'screw', len: 13, dia: 4 },
    qty: { '2_compartments': 4, '3_compartments': 6 },
  },
  {
    part_id: '112792',
    name: 'Bracket screw',
    match: { kind: 'screw', len: 13, dia: 4 },
    qty: { '2_compartments': 16, '3_compartments': 24 },
  },
  {
    part_id: '10097027',
    name: 'Bushing',
    match: { kind: 'spacer', nameIncludes: 'bush' },
    qty: { '2_compartments': 4, '3_compartments': 6 },
  },
  {
    part_id: '100347',
    name: 'Pivot screw',
    match: { kind: 'screw', len: 10, dia: 3.5 },
    qty: { '2_compartments': 4, '3_compartments': 6 },
  },
  {
    part_id: '109048',
    name: 'Wall screw',
    match: { kind: 'screw', len: 60, dia: 5 },
    qty: { '2_compartments': 2, '3_compartments': 2 },
  },
  {
    part_id: '121714',
    name: 'Washer',
    match: { kind: 'washer' },
    qty: { '2_compartments': 2, '3_compartments': 2 },
  },
  {
    part_id: '100823',
    name: 'Wall plug',
    match: { kind: 'plug' },
    qty: { '2_compartments': 2, '3_compartments': 2 },
  },
]

const byId = new Map(BISSA_PARTS.map((p) => [p.part_id, p]))

export function lookupBissaPart(partId: string | null | undefined): BissaPartInfo | null {
  if (!partId) return null
  return byId.get(partId.trim()) ?? null
}

export function partQuantity(partId: string, variant: ProductVariant): number | null {
  return lookupBissaPart(partId)?.qty[variant] ?? null
}

function scoreHw(
  h: { kind: string; len: number; dia: number; name: string },
  m: HwMatch,
): number {
  if (h.kind !== m.kind) return -1
  let s = 1
  if (m.len != null) s += h.len === m.len ? 8 : -Math.abs(h.len - m.len) * 0.05
  if (m.dia != null) s += h.dia === m.dia ? 8 : -Math.abs(h.dia - m.dia) * 0.2
  if (m.nameIncludes) {
    const ok = h.name.toLowerCase().includes(m.nameIncludes.toLowerCase())
    if (!ok) return -1
    s += 6
  }
  return s
}

/** Resolve an IKEA part number to a Bygga `plan.hardware[].id`, if geometry exists. */
export function resolveHwRef(plan: Plan, partId: string | null | undefined): string | null {
  const info = lookupBissaPart(partId)
  if (!info || !plan.hardware.length) return null
  let best: { id: string; score: number } | null = null
  for (const h of plan.hardware) {
    const score = scoreHw(h, info.match)
    if (score < 0) continue
    if (!best || score > best.score) best = { id: h.id, score }
  }
  return best?.id ?? null
}

/** Bare IKEA fittings id in user text (6–8 digits). */
export function extractPartId(text: string): string | null {
  const m = text.toLowerCase().match(/\b(\d{6,8})\b/)
  return m?.[1] ?? null
}
