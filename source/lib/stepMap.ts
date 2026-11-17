import stepMapJson from '../data/bissa-step-map.json'
import { lookupBissaPart, partQuantity } from './bissaParts'
import type { ProductVariant, SessionVariables, StageVisualMode, VisualState } from './types'
import {
  agentAsksProductConfirm,
  agentAsksWhichProduct,
  agentImpliesUnsupportedProduct,
  clearedIdentifyVariables,
  isAssemblyNavIntent,
  isExplicitStepIntent,
  isProductArticleNumber,
  isProductIdentifyIntent,
  userNamesDifferentBissaVariant,
  userRejectsProductConfirm,
} from './visualMode'

type StepEntry = {
  manual_page: number
  pdf_step: number
  bygga_step: number | null
  fidelity: string
  notes?: string
}

type StepMapFile = {
  version: number
  updated: string
  notes?: string
  manuals: Record<
    ProductVariant,
    {
      doc_id: string
      path: string
      pages: number
      numbered_steps: number
      article_number_flowstore: string
      bygga_slug: string
      wall_step: number
      final_step: number
      plan_steps?: number
    }
  >
  /** @deprecated upstream 15-step titles; prefer stage_steps */
  bygga_steps?: Record<string, string>
  stage_steps?: Record<string, string>
  ui_rules: Record<string, string | boolean>
  '2_compartments': Record<string, StepEntry>
  '3_compartments': Record<string, StepEntry>
}

export function planStepCount(variant: ProductVariant): number {
  return stepMap.manuals[variant].plan_steps ?? stepMap.manuals[variant].final_step
}

export const stepMap = stepMapJson as unknown as StepMapFile

export function lastStepFor(variant: ProductVariant): number {
  return stepMap.manuals[variant].final_step
}

export function lookupStep(variant: ProductVariant, step: number): StepEntry | null {
  return stepMap[variant][String(step)] ?? null
}

/** Resolve Flowstore vars → visual panel state via the verified step map. */
export function deriveVisualState(
  vars: SessionVariables,
  priorByggaStep: number | null,
  visualMode: StageVisualMode = 'step',
): VisualState {
  const variant = vars.product_variant
  const preview = vars.preview_step
  const current = vars.current_step
  const focus_step = preview ?? current
  const focus_mode: VisualState['focus_mode'] =
    preview != null ? 'preview' : current != null ? 'working' : 'idle'
  const visual_mode: StageVisualMode =
    visualMode === 'idle' && focus_step != null ? 'step' : visualMode

  if (!variant || (focus_step == null && visual_mode === 'step')) {
    return {
      product_variant: variant,
      focus_step,
      focus_mode,
      visual_mode: visual_mode === 'step' ? 'idle' : visual_mode,
      manual_page: null,
      bygga_step: priorByggaStep,
      fidelity: null,
      notes: null,
      missing_part_id: vars.missing_part_id,
      wall_anchored: vars.wall_anchored,
      holding_prior: priorByggaStep != null && focus_step == null,
    }
  }

  const entry = focus_step != null ? lookupStep(variant, focus_step) : null
  const mapped = entry?.bygga_step ?? null
  // Gap beats (spacer) still have a plan index for 1:1 paging; banner is via fidelity.
  const holding_prior = visual_mode === 'step' && mapped == null
  const isGap = visual_mode === 'step' && entry?.fidelity === 'gap'

  return {
    product_variant: variant,
    focus_step,
    focus_mode,
    visual_mode,
    manual_page: entry?.manual_page ?? null,
    bygga_step: mapped ?? priorByggaStep,
    fidelity: entry?.fidelity ?? null,
    notes: entry?.notes ?? null,
    missing_part_id: vars.missing_part_id,
    wall_anchored: vars.wall_anchored,
    holding_prior: holding_prior || isGap,
  }
}

export function mergeVariables(
  base: SessionVariables,
  patch: Partial<SessionVariables> | undefined,
): SessionVariables {
  if (!patch) return base
  return { ...base, ...patch }
}

const SESSION_VAR_KEYS = new Set<keyof SessionVariables>([
  'product_name',
  'product_variant',
  'article_number',
  'product_supported',
  'current_step',
  'preview_step',
  'missing_part_id',
  'expected_part_quantity',
  'wall_anchored',
  'problem_description',
])

function coerceVariableValue(name: string, value: unknown): unknown {
  if (value == null) return null
  if (name === 'current_step' || name === 'preview_step' || name === 'expected_part_quantity') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value)
      return Number.isFinite(n) ? n : value
    }
  }
  if (name === 'product_supported' || name === 'wall_anchored') {
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 'True') return true
    if (value === 'false' || value === 'False') return false
  }
  return value
}

type RunnerishEvent = {
  type?: string
  variables?: Partial<SessionVariables>
  variable_name?: string
  value?: unknown
}

/** Pull the latest variable bag from runner-style events. */
export function variablesFromEvents(
  base: SessionVariables,
  events: RunnerishEvent[],
): SessionVariables {
  return events.reduce((acc, ev) => {
    // Mock-style bag patch
    if (ev.variables) acc = mergeVariables(acc, ev.variables)
    // flowstore-runner VariableSet: { type: "variable_set", variable_name, value }
    if (
      (ev.type === 'variable_set' || ev.variable_name) &&
      typeof ev.variable_name === 'string' &&
      SESSION_VAR_KEYS.has(ev.variable_name as keyof SessionVariables)
    ) {
      const key = ev.variable_name as keyof SessionVariables
      acc = mergeVariables(acc, {
        [key]: coerceVariableValue(key, ev.value),
      } as Partial<SessionVariables>)
    }
    return acc
  }, base)
}

/** Pull BISSA variant from user/agent prose when Live omits variable_set. */
export function inferProductFromText(
  userText: string,
  agentText: string,
  locked?: SessionVariables | null,
): Partial<SessionVariables> | null {
  // Reject / which-product / pending confirm — never treat as a confirmed model.
  if (
    userRejectsProductConfirm(userText) ||
    agentAsksWhichProduct(agentText) ||
    agentAsksProductConfirm(agentText)
  ) {
    return null
  }
  // Locked confirmed variant: ignore assembly nav; only change on explicit other model (IC-28).
  if (locked?.product_variant && locked.product_supported !== false) {
    if (isAssemblyNavIntent(userText)) return null
    if (!userNamesDifferentBissaVariant(userText, locked.product_variant)) return null
  }
  const both = `${userText}\n${agentText}`.toLowerCase()
  if (/\bbilly\b/.test(both) && !/\bbissa\b/.test(both)) return null
  // Prefer user text for variant — agent may mention a guess before confirm.
  const fromUser = userText.toLowerCase()
  if (/3[\s-]?comp|three[\s-]?compartment|10530259|105\.302\.59/.test(fromUser)) {
    return {
      product_name: 'BISSA',
      product_variant: '3_compartments',
      article_number: '10530259',
      product_supported: true,
    }
  }
  if (/2[\s-]?comp|two[\s-]?compartment|70530256|705\.302\.56/.test(fromUser)) {
    return {
      product_name: 'BISSA',
      product_variant: '2_compartments',
      article_number: '70530256',
      product_supported: true,
    }
  }
  // User said yes/confirm and agent named the variant in the reply.
  if (
    /^(yes|yep|yeah|correct|confirm(?:ed)?|that'?s\s+(it|correct|right)|looks\s+right)\b/.test(
      fromUser.trim(),
    )
  ) {
    if (/3[\s-]?comp|three[\s-]?compartment|10530259|105\.302\.59/.test(both)) {
      return {
        product_name: 'BISSA',
        product_variant: '3_compartments',
        article_number: '10530259',
        product_supported: true,
      }
    }
    if (/2[\s-]?comp|two[\s-]?compartment|70530256|705\.302\.56/.test(both)) {
      return {
        product_name: 'BISSA',
        product_variant: '2_compartments',
        article_number: '70530256',
        product_supported: true,
      }
    }
  }
  // Explicit full model in agent confirm-success prose (“Confirmed: BISSA 2-compartment…”).
  if (
    /\b(confirmed|got it|you.?re on)\b/.test(both) &&
    /3[\s-]?comp|three[\s-]?compartment|10530259|105\.302\.59/.test(both)
  ) {
    return {
      product_name: 'BISSA',
      product_variant: '3_compartments',
      article_number: '10530259',
      product_supported: true,
    }
  }
  if (
    /\b(confirmed|got it|you.?re on)\b/.test(both) &&
    /2[\s-]?comp|two[\s-]?compartment|70530256|705\.302\.56/.test(both)
  ) {
    return {
      product_name: 'BISSA',
      product_variant: '2_compartments',
      article_number: '70530256',
      product_supported: true,
    }
  }
  if (/\bbissa\b/.test(fromUser) || (/\bbissa\b/.test(both) && !agentAsksProductConfirm(agentText))) {
    // Named BISSA without compartment count — name only; no fake variant.
    return {
      product_name: 'BISSA',
      product_supported: true,
    }
  }
  return null
}

/**
 * Demo fallback when Live agent replies about a step but doesn't fire
 * variable_set assigns. Mirrors mockChat step jump / preview parsing.
 */
export function inferStepVariablesFromText(
  userText: string,
  agentText: string,
  vars: SessionVariables,
  /** Pre-turn vars — used so next/back don’t double-advance after mock/LIVE assigns. */
  prior?: SessionVariables,
): SessionVariables {
  const lowerUser = userText.toLowerCase().trim()
  const lowerAgent = agentText.toLowerCase()

  // Menu pick of an unsupported product (e.g. “3” → BILLY) — keep overview, clear step.
  if (agentImpliesUnsupportedProduct(agentText)) {
    return mergeVariables(vars, {
      current_step: null,
      preview_step: null,
      missing_part_id: null,
      product_supported: false,
    })
  }

  const stepAsk = isExplicitStepIntent(userText)
  const assemblyNav = isAssemblyNavIntent(userText)
  const alreadyConfirmed = Boolean(vars.product_variant) && vars.product_supported !== false

  // Reject → wipe leftover product (IC-23). Never wipe on assembly nav once confirmed (IC-26/28).
  if (userRejectsProductConfirm(userText) && !assemblyNav) {
    return mergeVariables(vars, clearedIdentifyVariables(vars))
  }
  if (agentAsksWhichProduct(agentText) && !alreadyConfirmed && !assemblyNav) {
    return mergeVariables(vars, clearedIdentifyVariables(vars))
  }

  // Pending yes/no confirm — only while still identifying, not mid-assembly.
  if (agentAsksProductConfirm(agentText) && !alreadyConfirmed && !assemblyNav) {
    return mergeVariables(vars, {
      current_step: null,
      preview_step: null,
      missing_part_id: null,
      expected_part_quantity: null,
    })
  }

  // Live often names BISSA / step in prose without assigns — seed product first.
  // Pass locked vars so assembly nav cannot flip 3-comp → 2-comp (IC-28).
  const inferredProduct = inferProductFromText(userText, agentText, vars)
  let next = inferredProduct ? mergeVariables(vars, inferredProduct) : vars
  // If Live cleared the locked variant on a non-switch turn, restore it.
  if (
    alreadyConfirmed &&
    !next.product_variant &&
    !userNamesDifferentBissaVariant(userText, vars.product_variant) &&
    !userRejectsProductConfirm(userText)
  ) {
    next = mergeVariables(next, {
      product_name: vars.product_name,
      product_variant: vars.product_variant,
      article_number: vars.article_number,
      product_supported: vars.product_supported,
    })
  }
  if (next.product_variant && next.product_supported == null) {
    next = mergeVariables(next, { product_supported: true })
  }

  // Identify / confirm product → clear step/part focus (never treat article # as a fitting).
  // Skip when the user is asking for a step (IC-26).
  if (!stepAsk && isProductIdentifyIntent(userText, agentText)) {
    return mergeVariables(next, {
      missing_part_id: null,
      expected_part_quantity: null,
      current_step: null,
      preview_step: null,
      problem_description: null,
    })
  }

  // Drop stale article-as-part mistakes (e.g. missing_part_id = 70530256).
  if (next.missing_part_id && isProductArticleNumber(next.missing_part_id)) {
    next = mergeVariables(next, { missing_part_id: null, expected_part_quantity: null })
  }

  const variant = next.product_variant
  if (!variant || next.product_supported === false) return next

  const max = lastStepFor(variant)
  const clamp = (n: number) => Math.max(1, Math.min(max, n))

  const previewUser = lowerUser.match(/\bpreview(?:ing)?\s+(?:step\s+)?(\d{1,2})\b/)
  if (previewUser) {
    return mergeVariables(next, { preview_step: clamp(Number(previewUser[1])) })
  }

  // Bare integers are menu choices, not steps — require “step N” (not just “3”).
  if (/\bstart from (the )?beginning\b/.test(lowerUser)) {
    return mergeVariables(next, {
      current_step: 1,
      preview_step: null,
      missing_part_id: null,
    })
  }
  if (/\blast step\b/.test(lowerUser)) {
    return mergeVariables(next, {
      current_step: max,
      preview_step: null,
      missing_part_id: null,
    })
  }

  const jumpUser = lowerUser.match(/\b(?:step|on)\s*(\d{1,2})\b/)
  if (jumpUser) {
    return mergeVariables(next, {
      current_step: clamp(Number(jumpUser[1])),
      preview_step: null,
      missing_part_id: null,
    })
  }

  if (/^(next|continue|done)\b/.test(lowerUser) || /\bnext step\b/.test(lowerUser)) {
    // Trust mock/LIVE if they already moved current_step this turn (walkthrough beat 07).
    if (
      prior &&
      next.current_step != null &&
      prior.current_step != null &&
      next.current_step !== prior.current_step
    ) {
      return mergeVariables(next, { preview_step: null, missing_part_id: null })
    }
    const cur = next.current_step ?? prior?.current_step ?? 0
    return mergeVariables(next, {
      current_step: clamp(cur + 1),
      preview_step: null,
      missing_part_id: null,
    })
  }

  if (/^(back|previous|prev)\b/.test(lowerUser) || /\bprevious step\b/.test(lowerUser)) {
    if (
      prior &&
      next.current_step != null &&
      prior.current_step != null &&
      next.current_step !== prior.current_step
    ) {
      return mergeVariables(next, { preview_step: null, missing_part_id: null })
    }
    const cur = next.current_step ?? prior?.current_step ?? 1
    return mergeVariables(next, {
      current_step: clamp(cur - 1),
      preview_step: null,
      missing_part_id: null,
    })
  }

  // Missing / fittings — only known BISSA fitting ids (never product articles).
  const digitId = lowerUser.match(/\b(\d{6,8})\b/)?.[1] ?? null
  const fittingId =
    digitId && !isProductArticleNumber(digitId) && lookupBissaPart(digitId) ? digitId : null
  const asksPartsLang =
    /\b(missing|lost|can'?t find|cannot find|screw|dowel|cam|bolt|washer|plug)\b/.test(
      lowerUser,
    ) ||
    /\bparts?\s+(list|overview|inventory|bag)\b/.test(lowerUser) ||
    /\bshow\s+(me\s+)?(all\s+)?(the\s+)?parts\b/.test(lowerUser)
  if (fittingId || asksPartsLang) {
    const id = fittingId ?? (asksPartsLang ? next.missing_part_id : null)
    return mergeVariables(next, {
      missing_part_id: id,
      expected_part_quantity: id
        ? partQuantity(id, variant) ?? next.expected_part_quantity
        : next.expected_part_quantity,
      problem_description: asksPartsLang ? userText : next.problem_description,
    })
  }

  if (/\b(clear preview|stop preview|working step)\b/.test(lowerUser)) {
    return mergeVariables(next, { preview_step: null })
  }

  // If the agent clearly states a working / current step and we still have
  // none (or user didn't match above), adopt it.
  const agentStep =
    lowerAgent.match(/\b(?:working|current)\s+step(?:\s+is(?:\s+now)?)?\s*[:#]?\s*(\d{1,2})\b/) ||
    lowerAgent.match(
      /\b(?:now\s+(?:on|at)|moved to|jump(?:ing)? to|go(?:ing)?\s+to|let'?s\s+go\s+to)\s+step\s*(\d{1,2})\b/,
    ) ||
    lowerAgent.match(/\bstep\s+(\d{1,2})\s+of\s+\d{1,2}\b/) ||
    lowerAgent.match(/\bstep\s+(\d{1,2})\s+involves\b/) ||
    lowerAgent.match(/\bstep\s+(\d{1,2})\s+for\s+the\b/)
  if (agentStep) {
    const n = clamp(Number(agentStep[1]))
    // Prefer not to overwrite an explicit preview unless agent names working step.
    if (/\bpreview\b/.test(lowerAgent) && !/\bworking\b/.test(lowerAgent)) {
      return mergeVariables(next, { preview_step: n })
    }
    return mergeVariables(next, { current_step: n, preview_step: null })
  }

  return next
}
