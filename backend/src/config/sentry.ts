import * as Sentry from '@sentry/node'

// ponytail: SENTRY_DSN is optional — until the user supplies one this whole module is a
// no-op (no init call, no handlers registered, no console noise). Once DSN is set,
// Sentry.init()'s default integrations already cover uncaught exceptions and unhandled
// promise rejections at the process level — no need to hand-roll process.on() handlers.
export const sentryEnabled = Boolean(process.env.SENTRY_DSN)

if (sentryEnabled) {
  // Error monitoring only — no tracesSampleRate/performance tracing, that's not what
  // was asked for and it adds cost + auto-instrumentation surface for no benefit here.
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
  })
}

export { Sentry }
