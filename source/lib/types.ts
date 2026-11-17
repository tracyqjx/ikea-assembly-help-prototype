export type ProductVariant = '2_compartments' | '3_compartments'

export type FocusMode = 'working' | 'preview' | 'idle'

/** Sticky-stage intent — question type, not only step index. */
export type StageVisualMode = 'step' | 'parts_overview' | 'part' | 'assembled' | 'idle'

export type SessionVariables = {
  product_name: string | null
  product_variant: ProductVariant | null
  article_number: string | null
  product_supported: boolean | null
  current_step: number | null
  preview_step: number | null
  missing_part_id: string | null
  expected_part_quantity: number | null
  wall_anchored: boolean | null
  problem_description: string | null
}

export type ChatChoiceChip = {
  label: string
  /** Sent as the user turn when tapped (same path as typed chat). */
  text: string
}

export type ChatMessage = {
  id: string
  role: 'user' | 'agent' | 'system'
  text: string
  at: number
  /**
   * @deprecated IC-27 — sticky stage only; never attach in-bubble visuals.
   * Kept optional so old message snapshots don’t type-error.
   */
  stageVisual?: {
    visual: VisualState
    variant: ProductVariant
  }
  /** In-bubble tappable choices (e.g. BISSA 2- vs 3-compartment). */
  choiceChips?: ChatChoiceChip[]
  /** @deprecated Legacy img thumbs — unused. */
  stepThumb?: {
    src?: string
    alt?: string
    flowstore_step?: number
    bygga_step?: number | null
    manual_page?: number | null
  }
}

export type VisualState = {
  product_variant: ProductVariant | null
  focus_step: number | null
  focus_mode: FocusMode
  /** What the stage should depict for this question type. */
  visual_mode: StageVisualMode
  manual_page: number | null
  bygga_step: number | null
  fidelity: string | null
  notes: string | null
  missing_part_id: string | null
  wall_anchored: boolean | null
  holding_prior: boolean
}

export type RunnerEvent = {
  type?: string
  name?: string
  path?: string
  variables?: Partial<SessionVariables>
  [key: string]: unknown
}

export type TurnResult = {
  agent_text: string
  events: RunnerEvent[]
  variables: SessionVariables
}

export const emptyVariables = (): SessionVariables => ({
  product_name: null,
  product_variant: null,
  article_number: null,
  product_supported: null,
  current_step: null,
  preview_step: null,
  missing_part_id: null,
  expected_part_quantity: null,
  wall_anchored: null,
  problem_description: null,
})
