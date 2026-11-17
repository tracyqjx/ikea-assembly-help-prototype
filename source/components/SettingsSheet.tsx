type Props = {
  open: boolean
  status: string | null
  onClose: () => void
}

/** About sheet for the Mock UI prototype. */
export default function SettingsSheet({ open, status, onClose }: Props) {
  if (!open) return null

  return (
    <div className="settings-sheet" role="dialog" aria-label="About this prototype">
      <div className="settings-sheet__head">
        <h2>Mock prototype</h2>
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <p className="settings-lead">
        Scripted chat + sticky 3D. Product page → <strong>Open assembly help</strong>, then
        chips like Parts / Step 1 / Next.
      </p>

      {status ? <p className="settings-status">{status}</p> : null}
    </div>
  )
}
