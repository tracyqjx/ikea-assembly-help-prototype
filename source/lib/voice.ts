/**
 * Browser Web Speech STT for continuous mic mode on the Flowstore path.
 * Listening → same `onSend` / turn → Listening again. No TTS.
 */

export type VoicePhase = 'off' | 'listening' | 'thinking'

type BrowserSpeechRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((ev: { error?: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition

function recognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechInputSupported(): boolean {
  return typeof window !== 'undefined' && recognitionCtor() != null
}

export type ListenHandle = { stop: () => void }

let listenCooldown: Promise<void> = Promise.resolve()

function afterListenCooldown(ms = 350): Promise<void> {
  listenCooldown = listenCooldown.then(
    () => new Promise((r) => window.setTimeout(r, ms)),
    () => new Promise((r) => window.setTimeout(r, ms)),
  )
  return listenCooldown
}

/**
 * One dictation pass. Chrome/Safari end after a pause — caller restarts for continuous mode.
 * Avoids InvalidStateError by waiting for prior recognition to fully end before start.
 */
export function startListening(handlers: {
  onPartial?: (text: string) => void
  onFinal: (text: string) => void
  onError?: (message: string) => void
  onEnd?: () => void
}): ListenHandle | null {
  const Ctor = recognitionCtor()
  if (!Ctor) {
    handlers.onError?.('Speech input is not supported in this browser.')
    return null
  }

  let stopped = false
  let gotFinal = false
  let ended = false
  let rec: BrowserSpeechRecognition | null = null

  const finishEnd = () => {
    if (ended) return
    ended = true
    handlers.onEnd?.()
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    const r = rec
    rec = null
    if (!r) return
    // Prefer stop() so onend fires cleanly; abort() races with the next start() on Chrome.
    try {
      r.stop()
    } catch {
      try {
        r.abort()
      } catch {
        /* ignore */
      }
    }
  }

  void afterListenCooldown().then(() => {
    if (stopped) {
      finishEnd()
      return
    }
    const next = new Ctor()
    rec = next
    next.lang = 'en-US'
    // continuous:false is more reliable across Chrome + Safari for utterance turns.
    next.continuous = false
    next.interimResults = true
    next.maxAlternatives = 1

    next.onstart = () => {
      /* recognition live */
    }

    next.onresult = (ev) => {
      let interim = ''
      let finalText = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const row = ev.results[i]
        const piece = row[0]?.transcript ?? ''
        if (row.isFinal) finalText += piece
        else interim += piece
      }
      if (interim) handlers.onPartial?.(interim.trim())
      if (finalText.trim()) {
        gotFinal = true
        handlers.onFinal(finalText.trim())
        try {
          next.stop()
        } catch {
          /* ignore */
        }
      }
    }

    next.onerror = (ev) => {
      const code = ev.error ?? 'Speech recognition failed.'
      if (code === 'aborted' || code === 'no-speech' || code === 'audio-capture') {
        finishEnd()
        return
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        handlers.onError?.(
          'Microphone permission blocked — allow mic for this site in Chrome/Safari.',
        )
        finishEnd()
        return
      }
      handlers.onError?.(String(code))
      finishEnd()
    }

    next.onend = () => {
      rec = null
      finishEnd()
      void gotFinal
    }

    try {
      next.start()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      void afterListenCooldown(500).then(() => {
        if (stopped) {
          finishEnd()
          return
        }
        try {
          next.start()
        } catch {
          handlers.onError?.(msg)
          finishEnd()
        }
      })
    }
  })

  return { stop }
}

export function voicePhaseLabel(phase: VoicePhase): string {
  switch (phase) {
    case 'listening':
      return 'Listening'
    case 'thinking':
      return 'Thinking'
    default:
      return 'Voice off'
  }
}
