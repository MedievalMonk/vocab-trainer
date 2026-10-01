import { VocabService } from '../core/service'
import { IndexedDbStore } from '../core/store'

export type Route = 'review' | 'study' | 'library' | 'stats' | 'games'
const ROUTES: Route[] = ['review', 'study', 'library', 'stats', 'games']

const fromHash = (): Route => {
  const h = location.hash.replace(/^#\/?/, '') as Route
  return ROUTES.includes(h) ? h : 'review'
}

import type { ExerciseKind } from './exercises'

export interface SessionSpec {
  /** teach = first-exposure flashcard pass, no scoring. quiz = graded exercises. */
  kind: 'teach' | 'quiz'
  ids: string[]
  lock: 'mixed' | ExerciseKind
  /** Recorded on each review: 'repetition' | 'revisit'. */
  mode: string
  title: string
}

class AppState {
  session = $state.raw<SessionSpec | null>(null)
  /** Set when a new version of the app is installed and waiting; calling it switches over. */
  applyUpdate = $state.raw<(() => void) | null>(null)
  svc = $state.raw<VocabService | null>(null)
  /** Bumped after every write so views re-read the service. */
  rev = $state(0)
  error = $state<string | null>(null)
  route = $state<Route>('review')
  persisted = $state<boolean | null>(null)

  async init() {
    this.route = fromHash()
    addEventListener('hashchange', () => (this.route = fromHash()))
    // The phone's Back button closes a session instead of leaving the app.
    addEventListener('popstate', () => {
      if (this.session) {
        this.session = null
        this.bump()
      }
    })
    try {
      this.svc = await VocabService.open(new IndexedDbStore())
      this.persisted = (await navigator.storage?.persist?.()) ?? null
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    }
  }

  go(r: Route) {
    location.hash = '/' + r
  }

  startSession(spec: SessionSpec) {
    if (!spec.ids.length) return
    history.pushState({ session: 1 }, '')
    this.session = spec
  }

  endSession() {
    if (history.state?.session) history.back()
    else {
      this.session = null
      this.bump()
    }
  }

  bump() {
    this.rev++
  }

  /** Runs a write against the service, then refreshes every view. */
  async run<T>(fn: (s: VocabService) => Promise<T>): Promise<T> {
    try {
      return await fn(this.svc!)
    } finally {
      this.bump()
    }
  }
}

export const app = new AppState()
