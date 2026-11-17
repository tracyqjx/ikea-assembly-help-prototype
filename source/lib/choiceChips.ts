import {
  BISSA_VARIANT_CHIPS,
  needsBissaVariantChoice,
} from './products'
import type { ChatChoiceChip, SessionVariables } from './types'
import { isExplicitStepIntent } from './visualMode'

const YES_NO: ChatChoiceChip[] = [
  { label: 'Yes', text: 'yes' },
  { label: 'No', text: 'no' },
]

/** After confirm / “how can I help” — never variant pickers (IC-28). */
const AFTER_CONFIRM: ChatChoiceChip[] = [
  { label: 'Start assembly', text: 'start from the beginning' },
  { label: 'Jump to a step', text: 'jump to a step' },
  { label: 'Show parts', text: 'show parts' },
]

const STEP_FOLLOWUP: ChatChoiceChip[] = [
  { label: 'Next step', text: 'next' },
  { label: 'Previous', text: 'back' },
  { label: 'Show parts', text: 'show parts' },
  { label: 'I’m stuck', text: 'I need help with this step' },
]

/** Light “what to ask” row above the composer after a product is known (not on cold Identify). */
export const COMPOSER_SUGGEST_PRODUCT: ChatChoiceChip[] = [
  { label: 'Start from beginning', text: 'start from the beginning' },
  { label: 'Show parts', text: 'show parts' },
  { label: 'Jump to a step', text: 'jump to a step' },
]

export const COMPOSER_SUGGEST_STEP: ChatChoiceChip[] = [
  { label: 'Next step', text: 'next' },
  { label: 'Show parts', text: 'show parts' },
  { label: 'I’m stuck', text: 'I need help with this step' },
]

/** Agent is asking to switch / reconfirm a different model (Yes/No only). */
export function agentAsksProductSwitch(agentText: string): boolean {
  const a = agentText.toLowerCase()
  return (
    /\bpreviously confirmed\b/.test(a) ||
    /\bare you now assembling\b/.test(a) ||
    /\b(switch|switching|changed?|change) (to|the|your|products?|models?|variants?)\b/.test(a) ||
    /\bdifferent (ikea )?(product|model|variant|cabinet)\b/.test(a) ||
    /\bmeant the (2|3)[\s-]?comp/.test(a) ||
    (/\b(2|3)[\s-]?compartment\b/.test(a) &&
      /\b(instead|rather|now|switch|wrong|other|different)\b/.test(a) &&
      /\?/.test(a))
  )
}

function agentAsksYesNo(agentText: string): boolean {
  if (agentAsksProductSwitch(agentText)) return true
  const a = agentText.toLowerCase()
  return (
    /\bis that (correct|right|the (right|correct) (one|model|product))\b/.test(a) ||
    /\bdoes that (sound|look) right\b/.test(a) ||
    /\b(can you )?(please )?confirm (this|that|the )?(product|model|bissa|variant|article)\b/.test(
      a,
    ) ||
    /\byes or no\b/.test(a) ||
    /\b(correct|right)\?\s*$/.test(a.trim())
  )
}

function agentJustConfirmedProduct(agentText: string): boolean {
  const a = agentText.toLowerCase()
  return (
    (/\b(confirmed|got it|you.?re on|perfect)\b/.test(a) &&
      /\b(bissa|compartment|article|assembled cabinet)\b/.test(a)) ||
    /\bhere.?s the assembled cabinet\b/.test(a) ||
    /\bhow can i help\b/.test(a) ||
    /\bwhat would you like (to do|help with)\b/.test(a) ||
    /\bwould you like to start from\b/.test(a)
  )
}

function agentGivesStepGuidance(agentText: string): boolean {
  const a = agentText.toLowerCase()
  return (
    /\bworking step is now\b/.test(a) ||
    /\bmoving to step\b/.test(a) ||
    /\bfollow the 3d stage\b/.test(a) ||
    /\bassembly instruction numbered\b/.test(a) ||
    /\bstep \d{1,2} of \d{1,2}\b/.test(a) ||
    /\bback to step\b/.test(a)
  )
}

/**
 * In-bubble presets only when the assistant clearly offers a choice.
 * Never used for the cold global first greeting.
 */
export function resolveChoiceChips(
  vars: SessionVariables,
  userText: string,
  agentText: string,
): ChatChoiceChip[] | undefined {
  if (!agentText.trim()) return undefined

  const u = userText.toLowerCase()
  const productReady = Boolean(vars.product_variant) && vars.product_supported !== false
  const onAStep = vars.current_step != null || vars.preview_step != null
  const stepAsk = isExplicitStepIntent(u)
  const partsAsk =
    /\bshow\s+(me\s+)?(all\s+)?(the\s+)?parts\b/.test(u) ||
    /\bi need help with this step\b/.test(u)

  // Switch / reconfirm prompts → Yes/No only (IC-28).
  if (agentAsksProductSwitch(agentText)) {
    return YES_NO
  }

  // Real step replies → follow-ups only (never variant chips / never on parts-only turns).
  if (productReady && agentGivesStepGuidance(agentText)) {
    return STEP_FOLLOWUP
  }
  if (
    productReady &&
    stepAsk &&
    !partsAsk &&
    !agentAsksYesNo(agentText) &&
    !agentJustConfirmedProduct(agentText)
  ) {
    return STEP_FOLLOWUP
  }

  // Identify only — never after a locked confirmed variant.
  if (!productReady && needsBissaVariantChoice(vars, userText, agentText)) {
    return BISSA_VARIANT_CHIPS
  }

  if (agentAsksYesNo(agentText)) {
    return YES_NO
  }

  // After confirm / how-can-I-help menu.
  if (
    productReady &&
    !onAStep &&
    !stepAsk &&
    !partsAsk &&
    agentJustConfirmedProduct(agentText)
  ) {
    return AFTER_CONFIRM
  }

  return undefined
}

/**
 * First agent greeting: never put product presets inside the bubble.
 */
export function greetingChoiceChips(
  _vars: SessionVariables,
  _cold: boolean,
): ChatChoiceChip[] | undefined {
  return undefined
}

/**
 * Light suggestions above the composer (IC-22 / IC-25).
 * Cold Identify / unconfirmed product → none.
 */
export function composerSuggestions(
  vars: SessionVariables,
  opts?: { cold?: boolean },
): ChatChoiceChip[] {
  const cold = opts?.cold === true
  if (cold || !vars.product_variant) {
    return []
  }
  if (vars.current_step != null || vars.preview_step != null) {
    return COMPOSER_SUGGEST_STEP
  }
  return COMPOSER_SUGGEST_PRODUCT
}
