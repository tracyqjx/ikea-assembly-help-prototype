import { useMemo, useState, type ReactNode } from 'react'
import type { ProductLaunchContext } from '../lib/products'
import { SAMPLE_PRODUCTS } from '../lib/products'
import IkeaIcon from './IkeaIcon'

type Props = {
  product: ProductLaunchContext
  onSelectSample: (p: ProductLaunchContext) => void
  onOpenHelp: () => void
}

type AccordionId =
  | 'materials'
  | 'assembly'
  | 'good'
  | 'safety'
  | 'measurements'
  | 'packaging'

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="pip-stars" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.min(1, Math.max(0, rating - i))
        return (
          <span key={i} className="pip-star">
            <span className="pip-star__base">★</span>
            <span className="pip-star__fill" style={{ width: `${fill * 100}%` }}>
              ★
            </span>
          </span>
        )
      })}
    </span>
  )
}

function IkeaLogo() {
  return (
    <img
      className="pip-logo"
      src="/ikea-logo.svg"
      alt=""
      width={80}
      height={33}
      decoding="async"
      draggable={false}
    />
  )
}

export default function ProductPage({
  product,
  onSelectSample,
  onOpenHelp,
}: Props) {
  const [qty, setQty] = useState(1)
  const [slide, setSlide] = useState(0)
  const [showStickyBag, setShowStickyBag] = useState(false)
  /** Official PIP tabs: Overview focuses Materials + Assembly only. */
  const [detailsTab, setDetailsTab] = useState<'overview' | 'details' | 'measurements'>('overview')
  const [open, setOpen] = useState<Record<AccordionId, boolean>>({
    materials: false,
    // Open on Overview so the demo CTA is visible without hunting.
    assembly: true,
    good: false,
    safety: false,
    measurements: true,
    packaging: false,
  })

  const gallery = useMemo(
    () => [
      product.images.hero,
      product.images.lifestyle,
      product.images.alt,
      product.images.open,
      product.images.dims,
    ],
    [product],
  )

  const toggle = (id: AccordionId) => {
    setOpen((s) => ({ ...s, [id]: !s[id] }))
  }

  const otherSamples = SAMPLE_PRODUCTS.filter(
    (p) => p.article_number !== product.article_number,
  )

  const familyPoints = product.price_dollars

  return (
    <div className="product-page">
      <div
        className="product-page__scroll"
        onScroll={(e) => {
          const el = e.currentTarget
          const midCta = el.querySelector('.pip-add-bag--inline') as HTMLElement | null
          const threshold = midCta ? midCta.offsetTop + midCta.offsetHeight - 40 : 720
          setShowStickyBag(el.scrollTop > threshold)
        }}
      >
      <div className="pip-utility">
        <button type="button" className="pip-utility__item" tabIndex={-1}>
          <IkeaIcon name="globe" size={20} /> EN
        </button>
        <button type="button" className="pip-utility__item" tabIndex={-1}>
          <IkeaIcon name="truck" size={20} /> Enter ZIP code
        </button>
        <button type="button" className="pip-utility__item" tabIndex={-1}>
          <IkeaIcon name="store" size={20} /> Select store
        </button>
      </div>

      <header className="pip-header">
        <a className="pip-logo-link" href="#top" aria-label="IKEA Home" onClick={(e) => e.preventDefault()}>
          <IkeaLogo />
        </a>
        <div className="pip-header__icons" aria-hidden>
          <span className="pip-icon-btn" aria-label="Profile">
            <IkeaIcon name="profile" size={24} />
          </span>
          <span className="pip-icon-btn" aria-label="Favorites">
            <IkeaIcon name="heart" size={24} />
          </span>
          <span className="pip-icon-btn" aria-label="Shopping bag">
            <IkeaIcon name="bag" size={24} />
          </span>
          <span className="pip-icon-btn" aria-label="Menu">
            <IkeaIcon name="menu" size={24} />
          </span>
        </div>
      </header>

      <div className="pip-search-wrap">
        <label className="pip-search">
          <IkeaIcon name="search" size={24} />
          <span>What are you looking for?</span>
        </label>
      </div>

      <div className="pip-promo">
        <IkeaIcon name="truck" size={24} />
        <a href="#delivery" onClick={(e) => e.preventDefault()}>
          Standard delivery starting at $19 for IKEA Family members*
        </a>
      </div>

      <nav className="pip-crumbs" aria-label="Breadcrumb">
        <span>…</span>
        <span className="pip-crumbs__sep">›</span>
        <span>Clothes organizers</span>
        <span className="pip-crumbs__sep">›</span>
        <span>Shoe cabinets</span>
      </nav>

      <section className="pip-gallery" aria-label="Product media">
        <div className="pip-gallery__frame">
          <img
            src={gallery[slide]}
            alt={`${product.product_name} ${product.variant_label}, ${product.color_label}`}
          />
          <button type="button" className="pip-gallery__heart" aria-label="Save to favorites" tabIndex={-1}>
            <IkeaIcon name="heart" size={24} />
          </button>
        </div>
        <div className="pip-dots" role="tablist" aria-label="Gallery pages">
          {gallery.map((_, i) => (
            <button
              key={i}
              type="button"
              className={i === slide ? 'pip-dot is-active' : 'pip-dot'}
              aria-label={`Image ${i + 1}`}
              onClick={() => setSlide(i)}
            />
          ))}
        </div>
      </section>

      <section className="pip-summary">
        <h1 className="pip-summary__title">
          <span className="pip-summary__name">{product.product_name}</span>{' '}
          <span className="pip-summary__desc">
            {product.variant_label}, {product.color_label},{' '}
            <a
              className="pip-summary__dims"
              href="#measurements"
              onClick={(e) => {
                e.preventDefault()
                setOpen((s) => ({ ...s, measurements: true }))
              }}
            >
              {product.dimensions}
            </a>
          </span>
        </h1>

        <p className="pip-price" aria-label={`Price $${product.price_dollars}.${product.price_cents}`}>
          <span className="pip-price__nowrap">
            <span className="pip-price__currency">$</span>
            <span className="pip-price__integer">{product.price_dollars}</span>
          </span>
          <span className="pip-price__decimal">
            <span className="pip-price__separator">.</span>
            {product.price_cents}
          </span>
        </p>

        <button type="button" className="pip-rating" tabIndex={-1}>
          <StarRow rating={product.rating} />
          <span className="pip-rating__count">({product.review_count})</span>
        </button>
      </section>

      <section className="pip-fulfillment" aria-labelledby="how-to-get-it">
        <h2 id="how-to-get-it">How to get it</h2>
        <ul className="pip-fulfillment__list">
          <li>
            <IkeaIcon name="store" size={20} />
            <div>
              <p>
                <span className="pip-stock-dot" /> In stock in{' '}
                <a href="#store" onClick={(e) => e.preventDefault()}>
                  IKEA Brooklyn, NY
                </a>
              </p>
              <p className="pip-muted">Opens at 11:00 AM</p>
              <a href="#find" onClick={(e) => e.preventDefault()}>
                Find in store
              </a>
            </div>
          </li>
          <li>
            <IkeaIcon name="store" size={20} />
            <div>
              <p>
                <span className="pip-stock-dot" /> Click and collect at{' '}
                <a href="#collect" onClick={(e) => e.preventDefault()}>
                  IKEA Brooklyn, NY
                </a>
              </p>
              <p className="pip-muted">
                From $2.00 or <strong className="pip-blue">Free with IKEA Family</strong>
              </p>
            </div>
          </li>
          <li>
            <IkeaIcon name="truck" size={20} />
            <div>
              <p>
                <span className="pip-stock-dot" /> Home delivery to{' '}
                <a href="#zip" onClick={(e) => e.preventDefault()}>
                  07306
                </a>
              </p>
            </div>
          </li>
        </ul>

        <div className="pip-qty" role="group" aria-label="Quantity">
          <button
            type="button"
            aria-label="Decrease quantity"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
          >
            −
          </button>
          <span>{qty}</span>
          <button type="button" aria-label="Increase quantity" onClick={() => setQty((q) => q + 1)}>
            +
          </button>
        </div>

        <button type="button" className="pip-add-bag pip-add-bag--inline" tabIndex={-1}>
          Add to bag
        </button>

        <div className="pip-services">
          <h3>Available services</h3>
          <div className="pip-services__row">
            <IkeaIcon name="drill" size={24} />
            <p>
              Have your {product.product_name} professionally assembled for <strong>$41.60</strong>
              *. <a href="#assembly-svc" onClick={(e) => e.preventDefault()}>Learn more</a>
            </p>
          </div>
          <p className="pip-services__note">*Minimum fee for assembly service is $52.00</p>
        </div>

        <div className="pip-family-points" id="demo-family">
          <span className="pip-family-badge" aria-hidden>
            <img src="/icons/family-badge.svg" alt="" width={24} height={24} />
          </span>
          <div className="pip-family-points__copy">
            <p className="pip-family-points__title">
              Collect {familyPoints} points with{' '}
              <a href="#family" onClick={(e) => e.preventDefault()}>
                IKEA Family
              </a>
            </p>
            <a
              className="pip-family-points__explore"
              href="#explore"
              onClick={(e) => e.preventDefault()}
            >
              Explore what you can get
            </a>
          </div>
        </div>
      </section>

      <section className="pip-policy">
        <div className="pip-policy__card">
          <div className="pip-policy__block">
            <h2>
              <span>It&apos;s OK to change your mind</span>
              <img className="pip-policy__icon" src="/icons/returns-arrow.svg" alt="" width={24} height={24} />
            </h2>
            <p>
              Return within 365 days for a full refund*.{' '}
              <a href="#returns" onClick={(e) => e.preventDefault()}>
                Learn more
              </a>
            </p>
          </div>
          <div className="pip-policy__block">
            <h2>
              <span>Low Price Guarantee</span>
              <img className="pip-policy__icon" src="/icons/shield-check.svg" alt="" width={24} height={24} />
            </h2>
            <p>
              Price drops? Get the difference back within 90 days with{' '}
              <a className="pip-family-link" href="#family" onClick={(e) => e.preventDefault()}>
                IKEA Family
              </a>
            </p>
          </div>
        </div>
      </section>

      <section className="pip-pay">
        <h2>More ways to pay</h2>
        <div className="pip-pay__card">
          <button type="button" className="pip-pay__row pip-pay__row--afterpay" tabIndex={-1}>
            <img
              className="pip-pay__afterpay"
              src="/icons/afterpay-logo.svg"
              alt="Afterpay"
              width={65}
              height={16}
            />
            <span className="pip-pay__detail">4 interest-free payments of $13 + tax</span>
          </button>
          <button type="button" className="pip-pay__row pip-pay__row--visa" tabIndex={-1}>
            <span className="pip-pay__visa-title">
              <strong>IKEA Visa Credit Card</strong>
              <img className="pip-pay__card-icon" src="/icons/credit-card.svg" alt="" width={24} height={24} />
            </span>
            <span className="pip-pay__detail">
              Earn 5% in rewards at IKEA using the IKEA Visa Credit Card*.
            </span>
          </button>
        </div>
      </section>

      <section className="pip-details" aria-labelledby="product-details-heading">
        <div className="pip-details__tabs" role="tablist" aria-label="Product information">
          {(
            [
              ['overview', 'Overview'],
              ['details', 'Product details'],
              ['measurements', 'Measurements'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={detailsTab === id}
              className={detailsTab === id ? 'is-active' : undefined}
              onClick={() => setDetailsTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {detailsTab === 'overview' && (
          <>
            <img
              className="pip-details__life"
              src={product.images.lifestyle}
              alt={`${product.product_name} in a hallway setting`}
            />

            <div className="pip-details__head">
              <h2 id="product-details-heading">{product.product_name}</h2>
              <span className="pip-article-badge">{product.article_display}</span>
            </div>
            <button type="button" className="pip-locate" tabIndex={-1}>
              <IkeaIcon name="store" size={20} /> Locate product in store
            </button>
            <p className="pip-details__copy">{product.description}</p>

            <h3 className="pip-more-info">More information</h3>
            <div className="pip-accordion">
              <Accordion
                id="ov-materials"
                title="Materials and care"
                open={open.materials}
                onToggle={() => toggle('materials')}
              >
                <MaterialsCareBody />
              </Accordion>
              <Accordion
                id="ov-assembly"
                title="Assembly and documents"
                open={open.assembly}
                onToggle={() => toggle('assembly')}
              >
                <AssemblyDocsBody
                  product={product}
                  onOpenHelp={onOpenHelp}
                  showHelpCta
                />
              </Accordion>
            </div>
          </>
        )}

        {detailsTab === 'details' && (
          <div className="pip-details__panel">
            <h2 className="pip-details__panel-title" id="product-details-heading">
              Product details
            </h2>
            <div className="pip-accordion">
              <Accordion
                id="pd-good"
                title="Good to know"
                open={open.good}
                onToggle={() => toggle('good')}
              >
                <p>Holds approx. {product.holds_pairs} pairs of shoes.</p>
                <p>
                  Different wall materials require different types of fasteners. Use fasteners
                  suitable for the walls in your home.
                </p>
              </Accordion>
              <Accordion
                id="pd-materials"
                title="Materials and care"
                open={open.materials}
                onToggle={() => toggle('materials')}
              >
                <MaterialsCareBody />
              </Accordion>
              <Accordion
                id="pd-safety"
                title="Safety and compliance"
                open={open.safety}
                onToggle={() => toggle('safety')}
              >
                <p>
                  This cabinet must be fastened to the wall; the back panel has predrilled holes to
                  make it easier.
                </p>
              </Accordion>
              <Accordion
                id="pd-assembly"
                title="Assembly and documents"
                open={open.assembly}
                onToggle={() => toggle('assembly')}
              >
                <AssemblyDocsBody product={product} showHelpCta={false} />
              </Accordion>
            </div>
          </div>
        )}

        {detailsTab === 'measurements' && (
          <div className="pip-details__panel" id="measurements">
            <h2 className="pip-details__panel-title">Measurements</h2>
            <div className="pip-accordion">
              <Accordion
                id="ms-measurements"
                title="Measurements"
                open={open.measurements}
                onToggle={() => toggle('measurements')}
              >
                <ul className="pip-measure-list">
                  {product.measurements.map((m) => (
                    <li key={m.label}>
                      <span>{m.label}</span>
                      <span>{m.value}</span>
                    </li>
                  ))}
                </ul>
              </Accordion>
              <Accordion
                id="ms-packaging"
                title="Packaging"
                open={open.packaging}
                onToggle={() => toggle('packaging')}
              >
                <p>
                  <strong>1 × {product.product_name}</strong>
                </p>
                <p>
                  {product.variant_label}
                  <span className="pip-article-badge pip-article-badge--sm">
                    {product.article_display}
                  </span>
                </p>
                <ul className="pip-measure-list">
                  {product.package_info.map((m) => (
                    <li key={m.label}>
                      <span>{m.label}</span>
                      <span>{m.value}</span>
                    </li>
                  ))}
                </ul>
              </Accordion>
            </div>
          </div>
        )}
      </section>

      <section className="pip-reviews" aria-labelledby="reviews-heading">
        <h2 id="reviews-heading">Customer reviews</h2>
        <div className="pip-reviews__summary">
          <div>
            <p className="pip-reviews__big">{product.rating.toFixed(1)}</p>
            <StarRow rating={product.rating} />
            <p className="pip-muted">Average rating</p>
          </div>
          <div className="pip-reviews__divider" />
          <div>
            <p className="pip-reviews__big">{product.review_count}</p>
            <p className="pip-muted">Reviews</p>
          </div>
        </div>
        <button type="button" className="pip-btn-pill" tabIndex={-1}>
          Show all reviews
        </button>
      </section>

      {otherSamples.length > 0 && (
        <section className="pip-related" aria-label="Also available">
          <h2>Also available</h2>
          <div className="pip-related__list">
            {otherSamples.map((p) => (
              <button
                key={p.article_number}
                type="button"
                className="pip-related__card"
                onClick={() => onSelectSample(p)}
              >
                <img src={p.images.hero} alt="" />
                <div>
                  <strong>{p.product_name}</strong>
                  <span>
                    {p.variant_label}, {p.color_label}
                  </span>
                  <span className="pip-related__price">
                    ${p.price_dollars}.{p.price_cents}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      </div>

      {showStickyBag ? (
        <div className="pip-sticky-bag">
          <button type="button" className="pip-add-bag" tabIndex={-1}>
            Add to bag
          </button>
        </div>
      ) : null}
    </div>
  )
}

function MaterialsCareBody() {
  return (
    <div className="pip-materials">
      <p className="pip-materials__h">Material</p>
      <p>
        Top panel / Side panel / Plinth front / Drawer front: Particleboard, Paper foil, Plastic
        edging
      </p>
      <p>Back rail: Particleboard, Paper foil</p>
      <p>
        Drawer divider / Drawer bottom / Drawer back: Particleboard, Paper foil, Plastic foil
      </p>
      <p>Drawer side: Polystyrene</p>
      <p className="pip-materials__h">Care</p>
      <p>Wipe clean using a damp cloth and a mild cleaner.</p>
      <p>Wipe dry with a clean cloth.</p>
    </div>
  )
}

function AssemblyDocsBody({
  product,
  onOpenHelp,
  showHelpCta,
}: {
  product: ProductLaunchContext
  onOpenHelp?: () => void
  showHelpCta: boolean
}) {
  return (
    <div className="pip-docs" aria-label="Assembly and documents">
      <DocRow
        icon="manual"
        title="Assembly instructions"
        productLabel={`${product.product_name} ${product.variant_label}`}
        article={product.article_display}
        href={product.assembly_pdf_url}
      />
      {/* Demo-only CTA — sits under Assembly instructions, before Advice/care. */}
      {showHelpCta && onOpenHelp ? (
        <button type="button" className="pip-btn-help-cta" onClick={onOpenHelp}>
          Open assembly help
        </button>
      ) : null}
      <DocRow
        icon="info"
        title="Advice and care instructions"
        productLabel={`${product.product_name} ${product.variant_label}`}
        article={product.article_display}
        href={product.advice_pdf_url}
      />
    </div>
  )
}

function DocRow({
  icon,
  title,
  productLabel,
  article,
  href,
}: {
  icon: 'manual' | 'info'
  title: string
  productLabel: string
  article: string
  href: string | null
}) {
  const body = (
    <>
      <span className="pip-doc-row__icon" aria-hidden>
        <IkeaIcon name={icon} size={22} />
      </span>
      <span className="pip-doc-row__text">
        <strong className="pip-doc-row__title">{title}</strong>
        <span className="pip-doc-row__name">{productLabel}</span>
        <span className="pip-article-badge pip-article-badge--doc">{article}</span>
      </span>
      <IkeaIcon name="external" size={20} className="pip-doc-row__ext" />
    </>
  )

  if (!href) {
    return (
      <div className="pip-doc-row pip-doc-row--disabled" aria-disabled>
        {body}
      </div>
    )
  }

  return (
    <a
      className="pip-doc-row"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {body}
    </a>
  )
}

function Accordion({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className={open ? 'pip-acc is-open' : 'pip-acc'}>
      <button
        type="button"
        className="pip-acc__btn"
        aria-expanded={open}
        aria-controls={`acc-${id}`}
        onClick={onToggle}
      >
        {title}
        <IkeaIcon name="chevron-down" size={20} className="pip-chevron" />
      </button>
      {open ? (
        <div className="pip-acc__panel" id={`acc-${id}`}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
