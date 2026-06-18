import { initializeApp } from 'firebase-admin/app'
import { createApp } from './app'

initializeApp()

const port = Number(process.env.PORT) || 8080
createApp().listen(port, () => {
  console.log(`Listening on port ${port}`)
})
