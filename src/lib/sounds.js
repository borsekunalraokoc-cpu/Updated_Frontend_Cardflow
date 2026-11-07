// Small Web Audio chimes, no audio files needed.

function playNotes(notes, { type, gap, peak, attack, length }) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    const ctx = new AudioCtx()
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      osc.connect(gain)
      gain.connect(ctx.destination)
      const start = ctx.currentTime + i * gap
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(peak, start + attack)
      gain.gain.exponentialRampToValueAtTime(0.001, start + length)
      osc.start(start)
      osc.stop(start + length)
    })
    setTimeout(() => ctx.close(), 2800)
  } catch (e) {
    console.warn('sound failed', e)
  }
}

// Soft ascending chime — a new card was added
export function playBellSound() {
  playNotes([523.25, 659.25, 783.99, 1046.5], {
    type: 'sine',
    gap: 0.22,
    peak: 0.3,
    attack: 0.05,
    length: 1.4,
  })
}

// Descending tone — a new issue appeared
export function playIssueSound() {
  playNotes([440, 349.23, 293.66], {
    type: 'triangle',
    gap: 0.32,
    peak: 0.32,
    attack: 0.03,
    length: 0.85,
  })
}