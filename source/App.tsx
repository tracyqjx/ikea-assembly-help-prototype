import { useEffect, useMemo, useRef, useState } from 'react'
import ChatColumn from './components/ChatColumn'
import IkeaIcon from './components/IkeaIcon'
import ProductPage from './components/ProductPage'
import SettingsSheet from './components/SettingsSheet'
import VisualPanel from './components/VisualPanel'
import { createMockSession } from './lib/mockChat'
import {
  composerSuggestions,
  greetingChoiceChips,
  resolveChoiceChips,
} from './lib/choiceChips'
import {
  coldStartGreeting,
  greetingFor,
  SAMPLE_PRODUCTS,
  type ProductLaunchContext,
} from './lib/products'
import {
  deriveVisualState,
  inferStepVariablesFromText,
  lastStepFor,
  mergeVariables,
} from './lib/stepMap'
import type { ChatMessage, ProductVariant, SessionVariables, StageVisualMode } from './lib/types'
import { emptyVariables } from './lib/types'
import { resolveVisualMode } from './lib/visualMode'

type Screen = 'product' | 'help'
type LayoutMode = 'mobile' | 'wide'

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Mock UI prototype. */
export default function App() {
  const [screen, setScreen] = useState<Screen>('product')
  const [product, setProduct] = useState<ProductLaunchContext>(SAMPLE_PRODUCTS[0])
  const [layout, setLayout] = useState<LayoutMode>('mobile')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [vars, setVars] = useState<SessionVariables>(emptyVariables())
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [stageExpanded, setStageExpanded] = useState(false)
  const [status] = useState<string | null>('Mock UI prototype.')
  const [error, setError] = useState<string | null>(null)
  const [lastFailedText, setLastFailedText] = useState<string | null>(null)
  /** PDP Open assembly help seeds product; FAB cold-start leaves Identify empty. */
  const [helpCold, setHelpCold] = useState(false)

  const priorBygga = useRef<number | null>(null)
  const mock = useRef(createMockSession(SAMPLE_PRODUCTS[0]))
  const [visualMode, setVisualMode] = useState<StageVisualMode>('idle')

  const visual = useMemo(() => {
    const next = deriveVisualState(vars, priorBygga.current, visualMode)
    if (next.bygga_step != null) priorBygga.current = next.bygga_step
    return next
  }, [vars, visualMode])

  /** Confirmed supported model — sticky shows once this is true (IC-23/29). */
  const productIdentified =
    Boolean(vars.product_variant) && vars.product_supported !== false
  const activeVariant: ProductVariant =
    vars.product_variant ??
    (helpCold ? '2_compartments' : product.product_variant ?? '2_compartments')
  // Cold Identify: blank until confirmed. PDP Open assembly help: seeded product is confirmed.
  const showStage = helpCold
    ? productIdentified
    : Boolean(
        (vars.product_variant ?? product.product_variant) &&
          (vars.product_supported ?? product.has_verified_guide) !== false,
      )
  const stepKey = `mode-${visual.visual_mode}-step-${visual.focus_step ?? 'x'}-${visual.bygga_step ?? 'hold'}`
  const maxStep = lastStepFor(activeVariant)
  const stageTitleName = vars.product_name ?? (!helpCold ? product.product_name : null)

  useEffect(() => {
    document.documentElement.dataset.layout = layout
  }, [layout])

  const openHelp = async (opts?: { cold?: boolean }) => {
    const cold = opts?.cold === true
    setHelpCold(cold)
    priorBygga.current = null

    const launchCtx: ProductLaunchContext | null = cold ? null : product
    mock.current.reset(launchCtx)

    const launchVars = (): SessionVariables => {
      if (cold) {
        return { ...emptyVariables(), current_step: null, preview_step: null }
      }
      return {
        ...emptyVariables(),
        product_name: product.product_name,
        product_variant: product.product_variant,
        article_number: product.article_number,
        product_supported: product.has_verified_guide,
        current_step: null,
      }
    }
    const launchVisual: StageVisualMode =
      !cold && product.has_verified_guide ? 'assembled' : 'idle'
    const seededVars = launchVars()
    const localGreet = cold ? coldStartGreeting() : greetingFor(product)
    const greet: ChatMessage = {
      id: uid(),
      role: 'agent',
      text: localGreet,
      at: Date.now(),
      choiceChips: greetingChoiceChips(seededVars, cold),
    }

    setError(null)
    setVars(seededVars)
    setVisualMode(launchVisual)
    setMessages([greet])
    setScreen('help')
  }

  const runTurn = async (
    text: string,
    opts?: { appendUser?: boolean },
  ): Promise<string | null> => {
    const appendUser = opts?.appendUser !== false
    setBusy(true)
    setError(null)
    setLastFailedText(null)
    if (appendUser) {
      setMessages((m) => [...m, { id: uid(), role: 'user', text, at: Date.now() }])
    }
    setVisualMode(resolveVisualMode(text, '', vars))
    try {
      const result = await mock.current.turn(text)
      let synced = result.variables
      if (!helpCold && product.product_variant) {
        synced = mergeVariables(synced, {
          product_name: synced.product_name ?? product.product_name,
          product_variant: synced.product_variant ?? product.product_variant,
          article_number: synced.article_number ?? product.article_number,
          product_supported:
            synced.product_supported ?? product.has_verified_guide,
        })
      }
      synced = inferStepVariablesFromText(text, result.agent_text, synced, vars)
      const nextMode = resolveVisualMode(text, result.agent_text, synced)
      setVars(synced)
      setVisualMode(nextMode)
      const choiceChips = resolveChoiceChips(synced, text, result.agent_text)
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: 'agent',
          text: result.agent_text,
          at: Date.now(),
          choiceChips,
        },
      ])
      return result.agent_text
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setLastFailedText(text)
      setMessages((m) => [
        ...m,
        { id: uid(), role: 'system', text: `Error: ${msg}`, at: Date.now() },
      ])
      return null
    } finally {
      setBusy(false)
    }
  }

  const onSend = (text: string) => runTurn(text)

  const backToProduct = () => {
    setScreen('product')
    setHelpCold(false)
  }

  return (
    <div className={`backdrop layout-${layout}`}>
      <p className="host-note">
        Target: <strong>IKEA mobile app</strong> WebView · Mock prototype
        <button
          type="button"
          className="host-note__link"
          onClick={() => setLayout((l) => (l === 'mobile' ? 'wide' : 'mobile'))}
        >
          {layout === 'mobile' ? 'Wide preview' : 'Phone preview'}
        </button>
      </p>

      <div
        className={[
          'phone',
          stageExpanded ? 'phone--stage-expanded' : '',
          `phone--${screen}`,
          screen === 'help' && !stageExpanded && !showStage ? 'phone--chat-first' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {screen === 'product' ? (
          <>
            <ProductPage
              key={product.article_number}
              product={product}
              onSelectSample={(p) => {
                setProduct(p)
                mock.current.reset(p)
              }}
              onOpenHelp={() => void openHelp()}
            />
            <button
              type="button"
              className="help-fab"
              onClick={() => void openHelp({ cold: true })}
              title="Start Assembly help without a product — Identify path"
              aria-label="Assembly help — start without product"
            >
              <IkeaIcon name="drill" size={22} />
              <span className="help-fab__label">Assembly help</span>
            </button>
          </>
        ) : (
          <>
            <header className="app-bar">
              <button type="button" className="back-btn" onClick={backToProduct} aria-label="Back to product">
                <IkeaIcon name="chevron-left" size={24} />
              </button>
              <div className="app-bar__brand">
                <img className="app-bar__logo" src="/ikea-logo.svg" alt="" width={80} height={33} />
                <div className="app-bar__titles">
                  <p className="brand">Assembly help</p>
                  <p className="brand-sub">
                    {helpCold && !vars.product_name
                      ? 'Identify your product'
                      : `${vars.product_name ?? product.product_name} · ${
                          vars.article_number
                            ? vars.article_number.replace(/(\d{3})(\d{3})(\d{2})/, '$1.$2.$3')
                            : product.article_display
                        }`}
                  </p>
                </div>
              </div>
              <div className="app-bar__actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="About"
                  onClick={() => setSettingsOpen(true)}
                >
                  <IkeaIcon name="menu" size={22} />
                </button>
              </div>
            </header>

            <SettingsSheet
              open={settingsOpen}
              status={status}
              onClose={() => setSettingsOpen(false)}
            />

            {error ? (
              <div className="banner-error" role="alert">
                <span>{error}</span>
              </div>
            ) : null}

            <main className="app-body">
              {showStage ? (
                <div className="stage-rail">
                  <div className="stage-rail__head">
                    <span>
                      {visual.visual_mode === 'assembled' || visual.visual_mode === 'idle'
                        ? `${stageTitleName ?? 'Product'} overview`
                        : visual.visual_mode === 'part' || visual.visual_mode === 'parts_overview'
                          ? 'Parts'
                          : `Step ${vars.current_step ?? vars.preview_step ?? '—'} / ${maxStep}`}
                      {visual.visual_mode === 'step' && visual.manual_page != null
                        ? ` · p. ${visual.manual_page}`
                        : ''}
                    </span>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => setStageExpanded((v) => !v)}
                    >
                      {stageExpanded ? 'Shrink 3D' : 'Expand 3D'}
                    </button>
                  </div>
                  <VisualPanel
                    key={`sticky-${activeVariant}-${showStage}`}
                    visual={visual}
                    variant={activeVariant}
                    stepKey={stepKey}
                    compact
                  />
                </div>
              ) : helpCold ? (
                <div className="stage-rail stage-rail--empty" aria-hidden>
                  <p>3D appears after you identify a supported product.</p>
                </div>
              ) : (
                <div className="stage-rail stage-rail--placeholder">
                  <p>No in-app 3D for this product yet — chat still works with the PDF manual.</p>
                </div>
              )}
              <ChatColumn
                messages={messages}
                busy={busy}
                onSend={onSend}
                suggestions={composerSuggestions(vars, {
                  cold: helpCold && !vars.product_variant,
                })}
                retryText={lastFailedText}
                onRetry={
                  lastFailedText
                    ? () => {
                        const t = lastFailedText
                        setMessages((m) => m.filter((msg) => msg.role !== 'system'))
                        void runTurn(t, { appendUser: false })
                      }
                    : undefined
                }
              />
            </main>
          </>
        )}
      </div>
    </div>
  )
}
