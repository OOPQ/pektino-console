let audioContext: AudioContext | null = null

function getContext() {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audioContext) audioContext = new Ctor()
  return audioContext
}

export function unlockAudio() {
  const ctx = getContext()
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {})
}

export function playDownloadChime() {
  const ctx = getContext()
  if (!ctx) return
  const play = () => {
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, now)
    osc.frequency.setValueAtTime(1174.66, now + 0.13)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.45)
  }
  if (ctx.state === 'suspended') {
    void ctx.resume().then(play).catch(() => {})
  } else {
    play()
  }
}