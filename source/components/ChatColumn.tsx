import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatChoiceChip, ChatMessage } from '../lib/types'
import {
  speechInputSupported,
  startListening,
  voicePhaseLabel,
  type ListenHandle,
  type VoicePhase,
} from '../lib/voice'

type Props = {
  messages: ChatMessage[]
  busy: boolean
  /** Same turn path as typed chat. */
  onSend: (text: string) => Promise<string | null>
  retryText?: string | null
  onRetry?: () => void
  /** Light “what to ask” chips above the composer (IC-22). */
  suggestions?: ChatChoiceChip[]
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
    </svg>
  )
}

export default function ChatColumn({
  messages,
  busy,
  onSend,
  retryText,
  onRetry,
  suggestions = [],
}: Props) {
  const [draft, setDraft] = useState('')
  const [voiceMode, setVoiceMode] = useState(false)
  const [phase, setPhase] = useState<VoicePhase>('off')
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const listenRef = useRef<ListenHandle | null>(null)
  const voiceModeRef = useRef(false)
  const phaseRef = useRef<VoicePhase>('off')
  const turnLock = useRef(false)
  /** When true, recognition onEnd must not auto-restart (final → turn in flight). */
  const suppressListenRestart = useRef(false)
  const onSendRef = useRef(onSend)
  const canMic = speechInputSupported()

  onSendRef.current = onSend

  useEffect(() => {
    voiceModeRef.current = voiceMode
  }, [voiceMode])
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, phase])

  const stopListening = useCallback(() => {
    listenRef.current?.stop()
    listenRef.current = null
  }, [])

  const beginListeningRef = useRef<() => void>(() => undefined)

  const runVoiceTurn = useCallback(
    async (text: string) => {
      if (turnLock.current) return
      turnLock.current = true
      suppressListenRestart.current = true
      stopListening()
      setPhase('thinking')
      try {
        await onSendRef.current(text)
        if (voiceModeRef.current) {
          turnLock.current = false
          suppressListenRestart.current = false
          beginListeningRef.current()
        } else {
          turnLock.current = false
          suppressListenRestart.current = false
          setPhase('off')
        }
      } catch {
        turnLock.current = false
        suppressListenRestart.current = false
        if (voiceModeRef.current) beginListeningRef.current()
        else setPhase('off')
      }
    },
    [stopListening],
  )

  const beginListening = useCallback(() => {
    if (!voiceModeRef.current) return
    if (!speechInputSupported()) {
      setVoiceHint('Voice input needs Chrome or Safari with mic permission.')
      setVoiceMode(false)
      setPhase('off')
      return
    }
    suppressListenRestart.current = false
    stopListening()
    setVoiceHint(null)
    setPhase('listening')

    const handle = startListening({
      onPartial: (t) => setDraft(t),
      onFinal: (t) => {
        listenRef.current = null
        setDraft('')
        if (!voiceModeRef.current) return
        if (!t) {
          window.setTimeout(() => {
            if (voiceModeRef.current && !turnLock.current) beginListeningRef.current()
          }, 300)
          return
        }
        suppressListenRestart.current = true
        void runVoiceTurn(t)
      },
      onError: (msg) => {
        listenRef.current = null
        if (/permission|not-allowed|blocked/i.test(msg)) {
          setVoiceHint(msg)
          setVoiceMode(false)
          setPhase('off')
          return
        }
        if (voiceModeRef.current && !turnLock.current && !suppressListenRestart.current) {
          window.setTimeout(() => {
            if (voiceModeRef.current && phaseRef.current === 'listening') {
              beginListeningRef.current()
            }
          }, 450)
        }
      },
      onEnd: () => {
        listenRef.current = null
        if (suppressListenRestart.current || turnLock.current) return
        if (!voiceModeRef.current) return
        if (phaseRef.current !== 'listening') return
        window.setTimeout(() => {
          if (
            voiceModeRef.current &&
            phaseRef.current === 'listening' &&
            !turnLock.current &&
            !suppressListenRestart.current
          ) {
            beginListeningRef.current()
          }
        }, 400)
      },
    })

    if (!handle) {
      setPhase('off')
      setVoiceMode(false)
      setVoiceHint('Could not start the microphone. Try Chrome or Safari and allow mic access.')
      return
    }
    listenRef.current = handle
  }, [runVoiceTurn, stopListening])

  beginListeningRef.current = beginListening

  useEffect(() => {
    return () => {
      stopListening()
    }
  }, [stopListening])

  const exitVoiceMode = useCallback(() => {
    voiceModeRef.current = false
    suppressListenRestart.current = true
    setVoiceMode(false)
    stopListening()
    setPhase('off')
    setDraft('')
  }, [stopListening])

  const toggleVoiceMode = () => {
    if (!canMic) {
      setVoiceHint('Voice input needs Chrome or Safari with mic permission.')
      return
    }
    if (voiceMode) {
      exitVoiceMode()
      return
    }
    setVoiceMode(true)
    voiceModeRef.current = true
    beginListening()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy || turnLock.current) return
    setDraft('')
    if (voiceMode) {
      await runVoiceTurn(text)
      return
    }
    await onSend(text)
  }

  const sendChip = async (text: string) => {
    if (busy || turnLock.current) return
    if (voiceMode) await runVoiceTurn(text)
    else await onSend(text)
  }

  const statusPhase: VoicePhase = voiceMode && phase === 'off' ? 'listening' : phase

  return (
    <section className="chat" aria-label="Assembly chat">
      <div className="chat-scroll" ref={scroller}>
        {messages.map((m) => (
          <article
            key={m.id}
            className={`bubble bubble--${m.role}`}
            style={{ animationDelay: '0ms' }}
          >
            <span className="bubble-role">
              {m.role === 'user' ? 'You' : m.role === 'agent' ? 'IKEA' : 'Note'}
            </span>
            <p>{m.text}</p>
            {m.role === 'agent' && m.choiceChips?.length ? (
              <div className="chat-chips chat-chips--in-bubble" role="group" aria-label="Suggested replies">
                {m.choiceChips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className="chat-chip"
                    disabled={busy || phase === 'thinking'}
                    onClick={() => void sendChip(c.text)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            ) : null}
            {m.role === 'system' && retryText && onRetry ? (
              <button type="button" className="bubble-retry" onClick={onRetry} disabled={busy}>
                Retry
              </button>
            ) : null}
          </article>
        ))}
        {busy || phase === 'thinking' ? (
          <div className="bubble bubble--agent bubble--typing" role="status" aria-live="polite">
            <span className="bubble-role">IKEA</span>
            <span className="typing-dots" aria-label="Thinking">
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : null}
      </div>

      {suggestions.length ? (
        <div
          className="chat-chips chat-chips--composer"
          role="group"
          aria-label="Suggested questions"
        >
          {suggestions.map((c) => (
            <button
              key={c.label}
              type="button"
              className="chat-chip chat-chip--suggest"
              disabled={busy || phase === 'thinking'}
              onClick={() => void sendChip(c.text)}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      {voiceMode ? (
        <div
          className={`voice-status voice-status--${statusPhase}`}
          role="status"
          aria-live="polite"
        >
          <span className="voice-status__dot" aria-hidden />
          <strong>{voicePhaseLabel(statusPhase)}</strong>
          <span className="voice-status__hint">Mic → chat · continuous</span>
        </div>
      ) : null}

      {voiceHint ? (
        <p className="composer-voice-hint" role="status">
          {voiceHint}
        </p>
      ) : null}

      <form className="composer" onSubmit={(e) => void submit(e)}>
        <button
          type="button"
          className={[
            'composer-mic',
            voiceMode ? 'is-voice-on' : '',
            phase === 'listening' ? 'is-listening' : '',
            phase === 'thinking' ? 'is-thinking' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={voiceMode ? 'Turn voice mode off' : 'Turn voice mode on'}
          aria-pressed={voiceMode}
          disabled={phase === 'thinking'}
          onClick={toggleVoiceMode}
          title={
            canMic
              ? 'Continuous listen — same chat send (no TTS)'
              : 'Speech recognition not available'
          }
        >
          <MicIcon />
        </button>
        <label className="sr-only" htmlFor="chat-input">
          Message
        </label>
        <input
          id="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            phase === 'listening'
              ? 'Listening… speak now'
              : phase === 'thinking'
                ? 'Thinking…'
                : 'Ask about a step, or say next…'
          }
          disabled={busy || phase === 'thinking'}
          autoComplete="off"
        />
        <button type="submit" disabled={busy || phase === 'thinking' || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}
