import { extractPartId, lookupBissaPart, partQuantity } from './bissaParts'
import type { ProductLaunchContext } from './products'
import type { ProductVariant, SessionVariables, TurnResult } from './types'
import { emptyVariables } from './types'

type MockState = {
  vars: SessionVariables
  turn: number
  ctx: ProductLaunchContext | null
}

function reply(
  state: MockState,
  agent_text: string,
  patch: Partial<SessionVariables>,
): TurnResult {
  const variables = { ...state.vars, ...patch }
  state.vars = variables
  state.turn += 1
  return {
    agent_text,
    events: [{ type: 'variables', variables: patch }],
    variables,
  }
}

function seedFromContext(ctx: ProductLaunchContext | null): SessionVariables {
  const base = emptyVariables()
  if (!ctx) return base
  return {
    ...base,
    product_name: ctx.product_name,
    product_variant: ctx.product_variant,
    article_number: ctx.article_number,
    product_supported: ctx.has_verified_guide,
    // No working step until the user asks — landing shows assembled overview.
    current_step: null,
  }
}

export function createMockSession(ctx: ProductLaunchContext | null = null) {
  const state: MockState = {
    vars: seedFromContext(ctx),
    turn: 0,
    ctx,
  }

  const reset = (next: ProductLaunchContext | null = null) => {
    state.ctx = next
    state.vars = seedFromContext(next)
    state.turn = 0
  }

  const turn = async (raw: string): Promise<TurnResult> => {
    const text = raw.trim()
    const lower = text.toLowerCase()

    // Reject product guess / confirm → clear identity and ask again (no leftover visual).
    if (/^(no|nope|nah|wrong|incorrect|not (that|it|correct|right|this)|different (one|product|model))\b/.test(lower)) {
      // PDP-seeded sessions keep the launch product; cold Identify goes fully blank.
      if (state.ctx?.product_variant) {
        return reply(
          state,
          `Okay — staying on ${state.ctx.product_name} · ${state.ctx.article_display} from the product page. Ask about a step, parts, or say “next”.`,
          {
            product_name: state.ctx.product_name,
            product_variant: state.ctx.product_variant,
            article_number: state.ctx.article_number,
            product_supported: state.ctx.has_verified_guide,
            current_step: null,
            preview_step: null,
            missing_part_id: null,
          },
        )
      }
      return reply(
        state,
        'Okay, which product are you assembling? You can tell me the name or article number on the box or label.',
        {
          product_name: null,
          product_variant: null,
          article_number: null,
          product_supported: null,
          current_step: null,
          preview_step: null,
          missing_part_id: null,
          expected_part_quantity: null,
        },
      )
    }

    // Variant lock (IC-28): assembly nav never flips the model; only an explicit other variant does.
    const locked = state.vars.product_variant
    const assemblyNav =
      /(?:step|on)\s*\d{1,2}\b/.test(lower) ||
      /^(next|back|prev|previous|continue|done)\b/.test(lower) ||
      /\bstart from (the )?beginning\b/.test(lower) ||
      /\bjump to (a )?step\b/.test(lower) ||
      /\blast step\b/.test(lower) ||
      /\bshow\s+(me\s+)?(all\s+)?(the\s+)?parts\b/.test(lower) ||
      /\bi need help with this step\b/.test(lower) ||
      /\bi'?m stuck\b/.test(lower)
    const names3 = /3[\s-]?comp|three compartment|10530259/.test(lower)
    const names2 = /2[\s-]?comp|two compartment|70530256/.test(lower)

    if (!assemblyNav && names3 && locked !== '3_compartments') {
      return reply(
        state,
        locked
          ? 'Got it — switching to BISSA 3-compartment (article 105.302.59). Great! How can I help — start assembly, jump to a step, or show parts?'
          : 'Got it — BISSA 3-compartment (article 105.302.59). Great! How can I help — start assembly, jump to a step, or show parts?',
        {
          product_name: 'BISSA',
          product_variant: '3_compartments',
          article_number: '10530259',
          product_supported: true,
          current_step: null,
          preview_step: null,
          missing_part_id: null,
        },
      )
    }
    if (!assemblyNav && names2 && locked !== '2_compartments') {
      return reply(
        state,
        locked
          ? 'Got it — switching to BISSA 2-compartment (article 705.302.56). Great! How can I help — start assembly, jump to a step, or show parts?'
          : 'Confirmed: BISSA 2-compartment (article 705.302.56). Great! How can I help — start assembly, jump to a step, or show parts?',
        {
          product_name: 'BISSA',
          product_variant: '2_compartments',
          article_number: '70530256',
          product_supported: true,
          current_step: null,
          preview_step: null,
          missing_part_id: null,
        },
      )
    }
    // Same variant named again while locked → confirm menu, do not re-open switch.
    if (!assemblyNav && locked && ((locked === '3_compartments' && names3) || (locked === '2_compartments' && names2))) {
      return reply(
        state,
        `You’re on BISSA ${locked === '3_compartments' ? '3' : '2'}-compartment. Great! How can I help — start assembly, jump to a step, or show parts?`,
        { current_step: null, preview_step: null, missing_part_id: null },
      )
    }

    // Named BISSA but not which compartment — offer variant chips in the UI.
    if (/\bbissa\b/.test(lower) && !state.vars.product_variant) {
      return reply(
        state,
        'BISSA comes in two verified models for this demo. Which one are you assembling?',
        {
          product_name: 'BISSA',
          product_variant: null,
          article_number: null,
          product_supported: true,
          current_step: null,
          preview_step: null,
          missing_part_id: null,
        },
      )
    }

    if (!state.vars.product_variant) {
      if (state.ctx && !state.ctx.has_verified_guide) {
        return reply(
          state,
          `I don’t have a verified step map for ${state.ctx.product_name} yet. Open the PDF from Manual, or try a verified sample (BISSA 2- or 3-compartment) for the class walkthrough.`,
          { product_name: state.ctx.product_name, article_number: state.ctx.article_number },
        )
      }
      // Prefer launch context over asking “which product?” again.
      if (state.ctx?.product_variant) {
        return reply(
          state,
          `You’re on ${state.ctx.product_name} · ${state.ctx.article_display}. Ask about a step, a fitting, or say “next” to begin.`,
          {
            product_name: state.ctx.product_name,
            product_variant: state.ctx.product_variant,
            article_number: state.ctx.article_number,
            product_supported: state.ctx.has_verified_guide,
          },
        )
      }
      return reply(
        state,
        'Which product are you assembling? For this class demo, try BISSA — then pick 2- or 3-compartment.',
        {
          product_name: null,
          product_variant: null,
          article_number: null,
          product_supported: null,
        },
      )
    }

    const variant = state.vars.product_variant as ProductVariant
    const max = variant === '2_compartments' ? 23 : 24

    if (/\bstart from (the )?beginning\b/.test(lower)) {
      return reply(
        state,
        `Working step is now 1 of ${max}. Follow the 3D stage (mapped from the official manual via the step map).`,
        { current_step: 1, preview_step: null, missing_part_id: null },
      )
    }
    if (/\blast step\b/.test(lower)) {
      return reply(
        state,
        `Working step is now ${max} of ${max}. Follow the 3D stage (mapped from the official manual via the step map).`,
        { current_step: max, preview_step: null, missing_part_id: null },
      )
    }
    if (/\bjump to (a )?step\b/.test(lower)) {
      return reply(
        state,
        `Which step do you want (1–${max})? Say “step 9” (or another number) and I’ll open it on the stage.`,
        { preview_step: null, missing_part_id: null },
      )
    }

    // Bare integers are menu choices — require “step N” / on N.
    const jump = lower.match(/(?:step|on)\s*(\d{1,2})\b/)
    if (jump) {
      const n = Math.min(max, Math.max(1, Number(jump[1])))
      return reply(
        state,
        `Working step is now ${n} of ${max}. Follow the 3D stage (mapped from the official manual via the step map).`,
        { current_step: n, preview_step: null, missing_part_id: null },
      )
    }

    if (/preview\s*(\d{1,2})/.test(lower)) {
      const n = Math.min(max, Math.max(1, Number(lower.match(/preview\s*(\d{1,2})/)![1])))
      return reply(
        state,
        `Previewing step ${n} — your working step stays at ${state.vars.current_step ?? '—'}.`,
        { preview_step: n },
      )
    }

    if (/^(next|continue|done)\b/.test(lower) || /next step/.test(lower)) {
      // From landing (no step yet), “next” begins at step 1.
      const cur = state.vars.current_step
      const n = cur == null ? 1 : Math.min(max, cur + 1)
      const wall = variant === '2_compartments' ? 21 : 22
      const patch: Partial<SessionVariables> = {
        current_step: n,
        preview_step: null,
        missing_part_id: null,
      }
      if (n === wall) {
        return reply(
          state,
          `Step ${n}: wall-anchor this cabinet. Confirm when the wall screws are in.`,
          patch,
        )
      }
      if (n > wall && !state.vars.wall_anchored) patch.wall_anchored = true
      return reply(state, `Moving to step ${n} of ${max}.`, patch)
    }

    if (/^(back|prev|previous)\b/.test(lower)) {
      const cur = state.vars.current_step ?? 1
      const n = Math.max(1, cur - 1)
      return reply(state, `Back to step ${n}.`, {
        current_step: n,
        preview_step: null,
        missing_part_id: null,
      })
    }

    if (/wall|anchored|screwed to the wall/.test(lower)) {
      return reply(state, 'Marked wall-anchored. Keep going — stops are next on most paths.', {
        wall_anchored: true,
      })
    }

    // Parts overview (chip “Show parts” / “show parts”) — before single-fitting lookups.
    if (
      /\bshow\s+(me\s+)?(all\s+)?(the\s+)?parts\b/.test(lower) ||
      /\b(all\s+)?parts?\s+(list|overview|inventory|bag|laid\s+out)\b/.test(lower) ||
      /\bfittings?\s+(bag|overview|list)\b/.test(lower) ||
      /\bhardware\s+(list|overview|inventory)\b/.test(lower)
    ) {
      return reply(
        state,
        'Here’s the fittings bag / parts overview for your BISSA variant on the stage. Ask about a part number (e.g. missing 109048) for a close-up.',
        {
          missing_part_id: null,
          expected_part_quantity: null,
          problem_description: text,
        },
      )
    }

    const partId = extractPartId(lower)
    if (
      partId ||
      /missing|lost|can'?t find|cannot find|screw|dowel|cam|bolt|washer|plug/.test(lower)
    ) {
      const id = partId ?? '109535'
      const info = lookupBissaPart(id)
      const qty = partQuantity(id, variant) ?? (variant === '2_compartments' ? 4 : 6)
      const name = info?.name ?? 'fitting'
      return reply(
        state,
        info
          ? `That’s ${name} ${id} — ${qty} in the box for your variant. Showing it on the stage.`
          : `Parts overview on the stage — check the fittings bag for ${id}. Quantity depends on your variant.`,
        {
          missing_part_id: id,
          expected_part_quantity: qty,
          problem_description: text,
        },
      )
    }

    if (/clear preview|stop preview|working step/.test(lower)) {
      return reply(state, `Back to working step ${state.vars.current_step}.`, {
        preview_step: null,
      })
    }

    return reply(
      state,
      `Try “next”, “back”, “step 17”, “preview 12”, “missing 109535”, or “wall done”. Current working step: ${state.vars.current_step ?? '—'}.`,
      {},
    )
  }

  return {
    getVariables: () => state.vars,
    turn,
    reset,
  }
}
