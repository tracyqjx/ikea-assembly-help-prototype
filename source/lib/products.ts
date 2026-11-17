import type { ProductVariant } from './types'

/** Launch context the product page would pass into the assembly-help WebView. */
export type ProductLaunchContext = {
  product_name: string
  article_number: string
  /** Dotted display form, e.g. 705.302.56 */
  article_display: string
  variant_label: string
  color_label: string
  dimensions: string
  price_dollars: number
  price_cents: string
  rating: number
  review_count: number
  holds_pairs: number
  description: string
  /** When set, this demo can drive the BISSA 3D stage + step map. */
  product_variant: ProductVariant | null
  manual_doc_id: string | null
  manual_pages: number | null
  assembly_pdf_url: string | null
  advice_pdf_url: string | null
  has_verified_guide: boolean
  images: {
    hero: string
    lifestyle: string
    alt: string
    open: string
    dims: string
  }
  measurements: { label: string; value: string }[]
  package_info: { label: string; value: string }[]
}

export const SAMPLE_PRODUCTS: ProductLaunchContext[] = [
  {
    product_name: 'BISSA',
    article_number: '70530256',
    article_display: '705.302.56',
    variant_label: 'Shoe cabinet with 2 compartments',
    color_label: 'white',
    dimensions: '19 1/4x11x36 5/8 "',
    price_dollars: 49,
    price_cents: '99',
    rating: 4.5,
    review_count: 695,
    holds_pairs: 8,
    description:
      'Too many shoes and not enough shoe storage? Let the simple and functional BISSA shoe cabinet come to your rescue: an easy way to stay organized in the hallway while saving important floor space.',
    product_variant: '2_compartments',
    manual_doc_id: 'AA-2324659-5',
    manual_pages: 24,
    assembly_pdf_url:
      'https://www.ikea.com/us/en/assembly_instructions/bissa-shoe-cabinet-with-2-compartments-white__AA-2324659-5-100.pdf',
    advice_pdf_url:
      'https://www.ikea.com/us/en/manuals/bissa-shoe-cabinet-with-2-compartments-white__AA-2180177-2-2.pdf',
    has_verified_guide: true,
    images: {
      hero: '/product/bissa-2comp-hero.jpg',
      lifestyle: '/product/bissa-2comp-lifestyle.jpg',
      alt: '/product/bissa-2comp-alt.jpg',
      open: '/product/bissa-2comp-open.jpg',
      dims: '/product/bissa-2comp-dims.jpg',
    },
    measurements: [
      { label: 'Width', value: '19 1/4 "' },
      { label: 'Depth', value: '11 "' },
      { label: 'Height', value: '36 5/8 "' },
    ],
    package_info: [
      { label: 'Width', value: '17 "' },
      { label: 'Height', value: '3 "' },
      { label: 'Length', value: '37 ¾ "' },
      { label: 'Weight', value: '33 lb 1 oz' },
    ],
  },
  {
    product_name: 'BISSA',
    article_number: '10530259',
    article_display: '105.302.59',
    variant_label: 'Shoe cabinet with 3 compartments',
    color_label: 'white',
    dimensions: '19 1/4x11x53 1/8 "',
    price_dollars: 69,
    price_cents: '99',
    rating: 4.6,
    review_count: 732,
    holds_pairs: 12,
    description:
      'Too many shoes and not enough shoe storage? Let the simple and functional BISSA shoe cabinet come to your rescue: an easy way to stay organized in the hallway while saving important floor space.',
    product_variant: '3_compartments',
    manual_doc_id: 'AA-2324663-6',
    manual_pages: 24,
    assembly_pdf_url:
      'https://www.ikea.com/us/en/assembly_instructions/bissa-shoe-cabinet-with-3-compartments-white__AA-2324663-6-100.pdf',
    advice_pdf_url:
      'https://www.ikea.com/us/en/manuals/bissa-shoe-cabinet-with-3-compartments-white__AA-2180178-2-2.pdf',
    has_verified_guide: true,
    images: {
      hero: '/product/bissa-3comp-hero.jpg',
      lifestyle: '/product/bissa-3comp-lifestyle.jpg',
      alt: '/product/bissa-3comp-alt.jpg',
      open: '/product/bissa-3comp-open.jpg',
      dims: '/product/bissa-3comp-dims.jpg',
    },
    measurements: [
      { label: 'Width', value: '19 1/4 "' },
      { label: 'Depth', value: '11 "' },
      { label: 'Height', value: '53 1/8 "' },
    ],
    package_info: [
      { label: 'Width', value: '16 ¾ "' },
      { label: 'Height', value: '3 "' },
      { label: 'Length', value: '54 ¼ "' },
      { label: 'Weight', value: '45 lb 15 oz' },
    ],
  },
]

export function greetingFor(ctx: ProductLaunchContext): string {
  if (ctx.has_verified_guide) {
    return `Hi — I’m your assembly help for ${ctx.product_name} · ${ctx.article_display} (${ctx.variant_label}). Ask about a step, a fitting, or say “next” when you’re ready to start.`
  }
  return `Hi — I’m your assembly help for ${ctx.product_name} · ${ctx.article_display}. This product doesn’t have a verified in-app guide yet — I can still answer general questions, or open the PDF manual.`
}

/** Cold start (no PDP product) — open Identify; no assumed product presets in the bubble. */
export function coldStartGreeting(): string {
  return `Hi — I’m your IKEA assembly help. Which IKEA product are you assembling? You can tell me the name or article number on the box or label.`
}

/** In-bubble choices when BISSA is named but 2- vs 3-compartment isn’t confirmed. */
export const BISSA_VARIANT_CHIPS: { label: string; text: string }[] = [
  { label: '2-compartment · 705.302.56', text: 'BISSA 2-compartment 70530256' },
  { label: '3-compartment · 105.302.59', text: 'BISSA 3-compartment 10530259' },
]

/** True when we know BISSA but not which compartment count. */
export function needsBissaVariantChoice(
  vars: {
    product_name: string | null
    product_variant: string | null
    current_step?: number | null
    preview_step?: number | null
  },
  userText: string,
  agentText: string,
): boolean {
  // Confirmed model or already on a step → never show variant pickers (IC-26).
  if (vars.product_variant) return false
  if (vars.current_step != null || vars.preview_step != null) return false
  const u = userText.toLowerCase()
  const a = agentText.toLowerCase()
  // Step / assembly turns — follow-ups only, not 2- vs 3-comp.
  if (
    /\b(?:step|on)\s*\d{1,2}\b/.test(u) ||
    /^(next|back|prev|previous|continue|done)\b/.test(u) ||
    /\b(working )?step\s*\d{1,2}\b/.test(a) ||
    /\bmoving to step\b/.test(a) ||
    /\bfollow the 3d stage\b/.test(a)
  ) {
    return false
  }
  // This turn already picked a variant in free text — chips belong on the prior ask, not the confirm.
  if (/2[\s-]?comp|3[\s-]?comp|two[\s-]?compartment|three[\s-]?compartment|70530256|10530259/.test(u)) {
    return false
  }
  const both = `${userText}\n${agentText}\n${vars.product_name ?? ''}`.toLowerCase()
  return /\bbissa\b/.test(both)
}
