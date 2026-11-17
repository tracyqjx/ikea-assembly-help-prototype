/** Header icons: Figma exports in `/public/icons`. Other glyphs stay inline. */
export type IkeaIconName =
  | 'profile'
  | 'heart'
  | 'bag'
  | 'menu'
  | 'search'
  | 'globe'
  | 'truck'
  | 'store'
  | 'drill'
  | 'chevron-down'
  | 'chevron-left'
  | 'external'
  | 'info'
  | 'manual'

type Props = {
  name: IkeaIconName
  size?: number
  className?: string
  label?: string
}

/** Exact Figma header/utility/search icons (node 126:7952). */
const FIGMA_FILE_ICONS = new Set<IkeaIconName>([
  'profile',
  'heart',
  'bag',
  'menu',
  'search',
  'globe',
  'truck',
  'store',
  'drill',
])

const PATHS: Partial<Record<IkeaIconName, string>> = {
  'chevron-down': 'M12 16.5 4.5 9l1.4-1.4L12 13.7l6.1-6.1L19.5 9 12 16.5z',
  'chevron-left':
    'm7 12.0009 8.0012-8.0007 1.4142 1.4142-6.587 6.5866 6.5859 6.5868L15 20.002l-8-8.0011z',
  external:
    'M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z',
  info: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-6h2zm0-8h-2V7h2z',
  // Assembly-instructions doc glyph (not the Available-services drill).
  manual:
    'm11.2933 16.5964 4.9498-4.9498c1.9526-1.9526 1.9526-5.1184 0-7.071l-3.1816-3.1822L9.5259 4.929l3.1819 3.182-4.9497 4.9498c-1.9526 1.9526-1.9526 5.1184 0 7.071l2.4749 2.4749 3.5357-3.5356-2.4754-2.4747zm-1.0604 1.7679-.3538-.3537c-.781-.7811-.781-2.0474 0-2.8285l4.9497-4.9497c1.1716-1.1716 1.1716-3.071 0-4.2427l-1.0605-1.0605-.7069.707 1.0606 1.0606c.7811.781.7811 2.0474 0 2.8284L9.1723 14.475c-1.1716 1.1716-1.1716 3.071 0 4.2426l.3537.3537.7069-.707z',
  // Official PIP Available-services assembly icon (Skapa drill).
  drill:
    'M14 6H5v3h9V6zM3 4v7h3.983l-2.3093 4H3v6h11v-6h-3.5445l2.3094-4H16V9h2V8h3V6h-3V5h-2V4H3zm7.4555 7-2.3094 4H6.983l2.3094-4h1.163zM5 17h7v2H5v-2z',
}

export default function IkeaIcon({ name, size = 24, className, label }: Props) {
  const cls = className ? `ikea-icon ${className}` : 'ikea-icon'

  if (FIGMA_FILE_ICONS.has(name)) {
    return (
      <span
        className={cls}
        style={{
          width: size,
          height: size,
          backgroundColor: 'currentColor',
          WebkitMaskImage: `url(/icons/${name}.svg)`,
          maskImage: `url(/icons/${name}.svg)`,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
        aria-hidden={label ? undefined : true}
        aria-label={label}
        role={label ? 'img' : undefined}
      />
    )
  }

  const d = PATHS[name]
  if (!d) return null

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cls}
      focusable="false"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d={d} />
    </svg>
  )
}
