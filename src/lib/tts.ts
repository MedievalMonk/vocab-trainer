import { headword } from './exercises'

export const ttsAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang === 'en-GB') ??
    voices.find((v) => v.lang.startsWith('en-GB')) ??
    voices.find((v) => v.lang.startsWith('en'))
  )
}

/** Browser/OS speech synthesis: no external service. Phrases sound less natural than single words. */
export function speak(text: string) {
  if (!ttsAvailable) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(headword(text))
  const voice = pickVoice()
  u.lang = voice?.lang ?? 'en-GB'
  if (voice) u.voice = voice
  u.rate = 0.9
  speechSynthesis.speak(u)
}
