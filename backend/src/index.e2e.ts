import { initFirebase } from './config/firebase'
import { createApp } from './app'
import { StubAIProvider } from './providers/StubAIProvider'
import { StubTitleGenerator } from './providers/StubTitleGenerator'

initFirebase()

const port = Number(process.env.PORT) || 8080
createApp({ ai: new StubAIProvider(), titleGen: new StubTitleGenerator() }).listen(port, () => {
  console.log(`[e2e] Listening on port ${port}`)
})
