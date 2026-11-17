import { PlanBuilder } from '@bygga/lib/plan/builder'
import { buildCustom } from '@bygga/lib/plan/custom'
import bissaFamily from '@bygga/lib/plan/families/bissa'
import type { Plan, ProductSpec } from '@bygga/lib/types'
import { STAGE_MOTION_SCALE } from './stageMotion'
import type { ProductVariant } from './types'

/** Bump when builder DUR / stagger changes so HMR does not reuse old delay slots. */
const PLAN_CACHE_REV = `motion-${STAGE_MOTION_SCALE}-dur1.6`

const SIZES = {
  '2_compartments': { w: 49, h: 93, d: 28 },
  '3_compartments': { w: 49, h: 135, d: 28 },
} as const

const SLUGS = {
  '2_compartments': 'bissa-shoe-cabinet-2-compartments',
  '3_compartments': 'bissa-shoe-cabinet-3-compartments',
} as const

const ARTICLES = {
  '2_compartments': '70530256',
  '3_compartments': '10530259',
} as const

const COMPARTMENTS = {
  '2_compartments': 2,
  '3_compartments': 3,
} as const

const cache = new Map<string, Plan>()

export function articleFor(variant: ProductVariant): string {
  return ARTICLES[variant]
}

export function buildBissaPlan(variant: ProductVariant): Plan {
  const key = `${variant}:${PLAN_CACHE_REV}`
  const hit = cache.get(key)
  if (hit) return hit

  const size = SIZES[variant]
  const compartments = COMPARTMENTS[variant]
  const spec: ProductSpec & { compartments: number } = {
    name: 'BISSA',
    variant: `Shoe cabinet with ${compartments} compartments`,
    category: 'shoe',
    archetype: 'cabinet',
    size,
    minutes: compartments === 2 ? 45 : 60,
    people: 1,
    difficulty: 2,
    source: 'catalog',
    slug: SLUGS[variant],
    compartments,
  }

  const custom = bissaFamily.recipe?.(spec)
  if (!custom) {
    throw new Error(`BISSA recipe returned null for ${variant}`)
  }

  const builder = new PlanBuilder(spec)
  buildCustom(builder, { ...spec, custom })
  const plan = builder.build()

  // Sanity: expanded recipe should be 1:1 with Flowstore/PDF step counts.
  const expected = compartments === 2 ? 23 : 24
  if (plan.steps.length !== expected) {
    console.warn(
      `[bissaPlan] expected ${expected} steps for ${variant}, got ${plan.steps.length}`,
    )
  }

  cache.set(key, plan)
  return plan
}
