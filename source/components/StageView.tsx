import { useEffect, useRef } from 'react'
import type { Stage, StageMode, StageOptions } from '@bygga/engine/stage'
import type { Plan } from '@bygga/lib/types'
import '@bygga/stage.css'

export type StageHandle = {
  replay: () => void
  resetView: () => void
  setSpeed: (s: number) => void
  setPaused: (p: boolean) => void
}

type Props = {
  plan: Plan | null
  mode: StageMode
  className?: string
  options?: Omit<StageOptions, 'onIntroDone' | 'onHover' | 'onUserView'>
  onReady?: (h: StageHandle) => void
  paused?: boolean
  speed?: number
}

export default function StageView({
  plan,
  mode,
  className,
  options,
  onReady,
  paused,
  speed,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  const modeKey = JSON.stringify(mode)
  const latest = useRef({ plan, mode })
  const readyCb = useRef(onReady)
  const optionsRef = useRef(options)

  useEffect(() => {
    latest.current = { plan, mode }
  })
  useEffect(() => {
    readyCb.current = onReady
  })
  useEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    let alive = true
    let s: Stage | null = null
    let ro: ResizeObserver | null = null

    const applySize = () => {
      if (!alive || !s || !host.current) return
      const { clientWidth: w, clientHeight: h } = host.current
      if (w > 0 && h > 0) s.resize(w, h)
    }

    const applyPlanMode = () => {
      if (!alive || !s) return
      const { plan: p, mode: m } = latest.current
      if (p) {
        s.setPlan(p)
        s.setMode(m)
      }
      applySize()
    }

    void import('@bygga/engine/stage').then(({ Stage }) => {
      if (!alive || !host.current) return
      s = new Stage(host.current, { ...optionsRef.current })
      stage.current = s
      applyPlanMode()
      // Phone flex / chat-first → sticky often mounts at 0×0; keep resizing until painted (IC-29).
      requestAnimationFrame(() => {
        applySize()
        requestAnimationFrame(applySize)
      })
      window.setTimeout(applySize, 50)
      window.setTimeout(applySize, 200)
      window.setTimeout(applySize, 500)
      if (typeof ResizeObserver !== 'undefined' && host.current) {
        ro = new ResizeObserver(() => applySize())
        ro.observe(host.current)
      }
      readyCb.current?.({
        replay: () => s?.replay(),
        resetView: () => s?.resetView(),
        setSpeed: (v) => s?.setSpeed(v),
        setPaused: (v) => s?.setPaused(v),
      })
    })
    return () => {
      alive = false
      ro?.disconnect()
      s?.dispose()
      stage.current = null
    }
  }, [])

  useEffect(() => {
    const s = stage.current
    if (!s || !plan) return
    const fresh = s.plan !== plan
    s.setPlan(plan)
    if (fresh) s.setMode(latest.current.mode)
  }, [plan])

  useEffect(() => {
    const s = stage.current
    if (!s || !s.plan) return
    s.setMode(latest.current.mode)
  }, [modeKey])

  useEffect(() => {
    stage.current?.setPaused(!!paused)
  }, [paused])

  useEffect(() => {
    stage.current?.setSpeed(speed ?? 1)
  }, [speed])

  return <div ref={host} className={'stage ' + (className ?? '')} />
}
