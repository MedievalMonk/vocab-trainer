import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { app as appState } from './lib/app.svelte'
import { registerServiceWorker } from './lib/pwa'

registerServiceWorker((apply) => (appState.applyUpdate = apply))

// Dev only: a handle for poking at the app from the browser console.
if (import.meta.env.DEV) (window as unknown as { __app: typeof appState }).__app = appState

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
