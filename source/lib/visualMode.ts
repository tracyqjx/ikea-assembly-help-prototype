import { extractPartId, lookupBissaPart } from './bissaParts'
import type { SessionVariables, StageVisualMode } from './types'

export type { StageVisualMode }

/** Official BISSA product article numbers (not fittings). */
export const BISSA_PRODUCT_ARTICLES = new Set(['70530256', '10530259'])

export function normalizeArticleDigits(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function isProductArticleNumber(id: string | null | undefined): boolean {
  if (!id) return false
  return BISSA_PRODUCT_ARTICLES.has(normalizeArticleDigits(id))
}

/** Explicit step language only — bare “3” is often a product-menu choice (e.g. BILLY). */
export function isExplicitStepIntent(userText: string): boolean {
  const u = userText.toLowerCase().trim()
  return (
    /\b(?:step|on)\s*\d{1,2}\b/.test(u) ||
    /^(next|back|prev|previous|continue|done)\b/.test(u) ||
    /\bnext step\b/.test(u) ||
    /\bprevious step\b/.test(u) ||
    /\bpreview(?:ing)?\s+(?:step\s+)?\d{1,2}\b/.test(u) ||
    /\bstart from (the )?beginning\b/.test(u) ||
    /\bjump to (a )?step\b/.test(u) ||
    /\blast step\b/.test(u)
  )
}

/** True when the user clearly names the *other* BISSA variant than the locked one. */
export function userNamesDifferentBissaVariant(
  userText: string,
  current: SessionVariables['product_variant'],
): boolean {
  if (!current) return false
  const u = userText.toLowerCase()
  // Assembly nav never counts as naming a different variant (IC-28).
  if (isExplicitStepIntent(u)) return false
  if (/\bshow\s+(me\s+)?(all\s+)?(the\s+)?parts\b/.test(u)) return false
  if (/\bi need help with this step\b/.test(u)) return false
  const names2 = /2[\s-]?comp|two[\s-]?compartment|70530256|705\.302\.56/.test(u)
  const names3 = /3[\s-]?comp|three[\s-]?compartment|10530259|105\.302\.59/.test(u)
  if (current === '3_compartments' && names2 && !names3) return true
  if (current === '2_compartments' && names3 && !names2) return true
  return false
}

/** Normal assembly asks that must never reopen product switch (IC-28). */
export function isAssemblyNavIntent(userText: string): boolean {
  const u = userText.toLowerCase().trim()
  return (
    isExplicitStepIntent(u) ||
    /\bshow\s+(me\s+)?(all\s+)?(the\s+)?parts\b/.test(u) ||
    /\bi need help with this step\b/.test(u) ||
    /\bi'?m stuck\b/.test(u) ||
    /\bhow can i help\b/.test(u)
  )
}

export function agentImpliesUnsupportedProduct(agentText: string): boolean {
  const a = agentText.toLowerCase()
  return (
    /\bnot supported\b/.test(a) ||
    /\bdoes not have verified\b/.test(a) ||
    /\bno verified\b/.test(a) ||
    /\bunsupported\b/.test(a) ||
    /\bprototype does not\b/.test(a)
  )
}

/** Agent is asking which product — text-only; no sticky / bubble visual (IC-23). */
export function agentAsksWhichProduct(agentText: string): boolean {
  const a = agentText.toLowerCase()
  return (
    /\bwhich (ikea )?product (are you|do you|would you)\b/.test(a) ||
    /\bwhich product are you assembling\b/.test(a) ||
    /\btell me (the |which )?(product|model|article)\b/.test(a) ||
    /\bwhat (ikea )?product (are you|do you)\b/.test(a) ||
    /\bokay,? which product\b/.test(a)
  )
}

/** Agent is waiting on yes/no for a guessed model — still unconfirmed. */
export function agentAsksProductConfirm(agentText: string): boolean {
  const a = agentText.toLowerCase()
  // Do not match assembly-step “confirm the cams…” language — product identity only.
  const productish =
    /\b(bissa|product|model|article|compartment|70530256|10530259)\b/.test(a)
  if (!productish) return false
  return (
    /\bis that (correct|right|the (right|correct) (one|model|product))\b/.test(a) ||
    /\bdoes that (sound|look) right\b/.test(a) ||
    /\b(can you )?(please )?confirm (this|that|the )?(product|model|bissa|variant|article)\b/.test(
      a,
    ) ||
    /\byes or no\b/.test(a) ||
    /\bis this (the )?(right|correct)?\s*(bissa|model|product|one)\b/.test(a) ||
    (/\b(bissa|compartment|article)\b/.test(a) && /\b(correct|right)\?\s*$/.test(a.trim()))
  )
}

/** User rejected a product guess / confirm. */
export function userRejectsProductConfirm(userText: string): boolean {
  const u = userText.toLowerCase().trim()
  return /^(no|nope|nah|wrong|incorrect|not (that|it|correct|right|this)|different (one|product|model))\b/.test(
    u,
  )
}

/**
 * Sticky + in-bubble visuals only after a confirmed model (or PDP-seeded launch).
 * Identify-ask / pending confirm / reject → no visual (IC-23).
 * Once confirmed, step/parts turns always keep visuals (IC-26).
 */
export function productVisualAllowed(
  vars: SessionVariables,
  userText = '',
  agentText = '',
): boolean {
  if (!vars.product_variant) return false
  if (vars.product_supported === false) return false
  // Confirmed product + step/parts ask → always show (don’t blank on false identify hits).
  if (
    isExplicitStepIntent(userText) ||
    vars.current_step != null ||
    vars.preview_step != null
  ) {
    if (userRejectsProductConfirm(userText)) return false
    return true
  }
  if (userRejectsProductConfirm(userText)) return false
  if (agentAsksWhichProduct(agentText)) return false
  if (agentAsksProductConfirm(agentText)) return false
  return true
}

/** Clear product identity after reject / which-product (keep chat going cold). */
export function clearedIdentifyVariables(
  vars: SessionVariables,
): Partial<SessionVariables> {
  return {
    product_name: null,
    product_variant: null,
    article_number: null,
    product_supported: null,
    current_step: null,
    preview_step: null,
    missing_part_id: null,
    expected_part_quantity: null,
    problem_description: vars.problem_description,
  }
}

/**
 * User/agent is identifying or confirming a BISSA model (not asking for parts).
 * Does not by itself authorize a visual — see productVisualAllowed.
 */
export function isProductIdentifyIntent(userText: string, agentText = ''): boolean {
  const u = userText.toLowerCase().trim()
  const a = agentText.toLowerCase()
  const both = `${u}\n${a}`

  // Step / parts turns are never “identify”, even if the agent mentions BISSA (IC-26).
  if (isExplicitStepIntent(userText)) return false
  if (
    /\bshow\s+(me\s+)?(all\s+)?(the\s+)?parts\b/.test(u) ||
    /\b(all\s+)?parts?\s+(list|overview|inventory|bag|laid\s+out)\b/.test(u) ||
    /\bfittings?\s+(bag|overview|list)\b/.test(u) ||
    /\b(missing|lost|can'?t find|cannot find)\b/.test(u) ||
    /\bi need help with this step\b/.test(u)
  ) {
    return false
  }

  if (agentAsksWhichProduct(agentText) || userRejectsProductConfirm(userText)) {
    return true
  }

  // Explicit parts asks in the agent reply also win over identify.
  if (
    /\bshow\s+(me\s+)?(all\s+)?(the\s+)?parts\b/.test(both) ||
    /\b(all\s+)?parts?\s+(list|overview|inventory|bag|laid\s+out)\b/.test(both) ||
    /\bfittings?\s+(bag|overview|list)\b/.test(both)
  ) {
    return false
  }

  // Agent talking about a working step → not identify.
  if (/\b(working )?step\s*\d{1,2}\b/.test(a) || /\bmoving to step\b/.test(a)) {
    return false
  }

  const namesBissaProduct =
    /\bbissa\b/.test(both) ||
    /70530256|10530259|705\.302\.56|105\.302\.59/.test(both) ||
    /2[\s-]?comp|two[\s-]?compartment|3[\s-]?comp|three[\s-]?compartment/.test(both)

  if (!namesBissaProduct) {
    // “yes” / “confirm” after Identify prompt — only if agent is confirming a model.
    if (
      /^(yes|yep|yeah|correct|confirm(?:ed)?|that'?s\s+(it|correct|right)|looks\s+right)\b/.test(u) &&
      /\b(bissa|70530256|10530259|2-compartment|3-compartment|confirm)\b/.test(a)
    ) {
      return true
    }
    return false
  }

  // Naming the product / article without a fittings ask → identify.
  return true
}

function isKnownFittingId(id: string | null | undefined): boolean {
  if (!id || isProductArticleNumber(id)) return false
  return lookupBissaPart(id) != null
}

/**
 * Prefer the user’s question type over a sticky step index.
 * Step jumps win; named fitting ids → part focus; then parts bag; then assembled.
 * Product identify/confirm → assembled cabinet (never parts overview).
 */
export function resolveVisualMode(
  userText: string,
  agentText: string,
  vars: SessionVariables,
): StageVisualMode {
  const u = userText.toLowerCase().trim()
  const a = agentText.toLowerCase()
  const both = `${u}\n${a}`

  const asksStep = isExplicitStepIntent(u)
  const confirmed =
    Boolean(vars.product_variant) && vars.product_supported !== false

  // Identify-ask / reject → idle only while unconfirmed (IC-23). Once locked, keep sticky (IC-29).
  if (userRejectsProductConfirm(userText) && !confirmed && !asksStep) {
    return 'idle'
  }
  if (
    !confirmed &&
    !asksStep &&
    (agentAsksWhichProduct(agentText) || agentAsksProductConfirm(agentText))
  ) {
    return 'idle'
  }

  // Unsupported product (e.g. BILLY menu pick) → keep calm overview, never advance BISSA steps.
  if (vars.product_supported === false || agentImpliesUnsupportedProduct(agentText)) {
    return vars.product_variant ? 'assembled' : 'idle'
  }

  // Successful identify/confirm with a known variant → finished cabinet hero.
  // Never steal a step ask (IC-26).
  if (!asksStep && isProductIdentifyIntent(userText, agentText)) {
    return confirmed ? 'assembled' : 'idle'
  }

  const rawPartId = extractPartId(u)
  const fittingId =
    rawPartId && isKnownFittingId(rawPartId)
      ? rawPartId
      : vars.missing_part_id && isKnownFittingId(vars.missing_part_id)
        ? vars.missing_part_id
        : null
  const knownPart = lookupBissaPart(fittingId)

  // Intent from the USER turn only — agent “how can I help… show parts” menus must not steal assembled (IC-29).
  const asksPartsBag =
    !!knownPart ||
    (!!fittingId &&
      /\b(missing|lost|can'?t find|cannot find|screw|dowel|cam|bolt|washer|plug|fitting)\b/.test(u))

  const asksParts =
    /\b(missing|lost|can'?t find|cannot find|extra)\b/.test(u) ||
    /\b(all\s+)?parts?\s+(list|overview|inventory|bag|laid\s+out)\b/.test(u) ||
    /\b(what|which)\s+parts\b/.test(u) ||
    /\bfittings?\s+(bag|overview|list)\b/.test(u) ||
    /\bhardware\s+(list|overview|inventory)\b/.test(u) ||
    /\bshow\s+(me\s+)?(all\s+)?(the\s+)?parts\b/.test(u) ||
    /\bpart\s+(number|id|#)\b/.test(u) ||
    // Only known fittings digits — never product article numbers like 70530256.
    (!!fittingId && isKnownFittingId(fittingId))

  const asksAssembled =
    /\b(fully\s+)?assembled\b/.test(u) ||
    /\bfinished\s+(product|cabinet|look)\b/.test(u) ||
    /\bcomplete\s+cabinet\b/.test(u) ||
    /\bshow\s+(me\s+)?(the\s+)?whole\s+(cabinet|product)\b/.test(u)

  // Confirmed product: always pick a sticky mode — never idle blank (IC-29).
  if (asksStep) return confirmed ? 'step' : 'idle'
  if (asksPartsBag) return confirmed ? 'part' : 'idle'
  if (asksParts) return confirmed ? 'parts_overview' : 'idle'
  // Stale missing_part_id from a bad article→part inference must not stick.
  if (vars.missing_part_id && isKnownFittingId(vars.missing_part_id)) {
    return confirmed ? 'parts_overview' : 'idle'
  }
  if (asksAssembled) return confirmed ? 'assembled' : 'idle'
  if (vars.preview_step != null || vars.current_step != null) {
    return confirmed ? 'step' : 'idle'
  }
  // Confirmed product (launch / identify) → calm assembled overview until a step/parts ask.
  if (confirmed) return 'assembled'
  return 'idle'
}

export function visualModeLabel(mode: StageVisualMode): string {
  switch (mode) {
    case 'parts_overview':
      return 'Parts overview'
    case 'part':
      return 'Part'
    case 'assembled':
      return 'Assembled'
    case 'step':
      return 'Step'
    default:
      return 'Idle'
  }
}
