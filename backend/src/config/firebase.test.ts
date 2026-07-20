import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initializeApp } from 'firebase-admin/app'

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}))

import { initFirebase } from './firebase'

describe('initFirebase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes the Admin SDK with the project ID from FIREBASE_PROJECT_ID', () => {
    process.env.FIREBASE_PROJECT_ID = 'corgi-8732c'
    initFirebase()
    expect(vi.mocked(initializeApp)).toHaveBeenCalledWith({ projectId: 'corgi-8732c' })
  })
})
