import { initLangfuse, shutdownLangfuse } from './config/langfuse'
import { initFirebase } from './config/firebase'
import { createApp } from './app'

initLangfuse()
initFirebase()

const port = Number(process.env.PORT) || 8080
const server = createApp().listen(port, () => {
  console.log(`Listening on port ${port}`)
})

process.on('SIGTERM', () => {
  server.close(() => {
    void shutdownLangfuse().finally(() => process.exit(0))
  })
  server.closeAllConnections()
})
