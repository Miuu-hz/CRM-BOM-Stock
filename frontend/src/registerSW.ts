export function registerSW() {
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        // Check for updates every 60 seconds
        setInterval(() => reg.update(), 60_000)
      })
      .catch(err => console.warn('[SW] Registration failed:', err))
  })
}
