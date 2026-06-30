import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGet, mockQuery, mockDb, mockTimestampFromDate } = vi.hoisted(() => {
  const mockGet = vi.fn()
  const mockQuery = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: mockGet,
  }
  const mockDb = { collection: vi.fn().mockReturnValue(mockQuery) }
  const mockTimestampFromDate = vi.fn((d: Date) => ({ _date: d, _type: 'Timestamp' }))
  return { mockGet, mockQuery, mockDb, mockTimestampFromDate }
})

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: {
    now: vi.fn(() => ({ toDate: () => new Date() })),
    fromDate: mockTimestampFromDate,
  },
}))

import { listEnglishMistakes } from './firestore'

function makeDoc(id: string, category: string) {
  return {
    id,
    data: () => ({
      uid: 'u1',
      conversationId: 'conv1',
      originalText: 'original',
      correctedText: 'corrected',
      category,
      severity: 'medium',
      patternKey: 'some_pattern',
      type: 'mistake',
      createdAt: { toDate: () => new Date('2026-06-27T10:00:00Z') },
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.where.mockReturnThis()
  mockQuery.orderBy.mockReturnThis()
  mockQuery.limit.mockReturnThis()
})

describe('listEnglishMistakes', () => {
  it('queries by uid and returns formatted docs', async () => {
    mockGet.mockResolvedValueOnce({ docs: [makeDoc('m1', 'grammar')] })
    const result = await listEnglishMistakes('u1', {})
    expect(mockDb.collection).toHaveBeenCalledWith('english_mistakes')
    expect(mockQuery.where).toHaveBeenCalledWith('uid', '==', 'u1')
    expect(mockQuery.orderBy).toHaveBeenCalledWith('createdAt', 'desc')
    expect(mockQuery.limit).toHaveBeenCalledWith(50)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 'm1',
      uid: 'u1',
      conversationId: 'conv1',
      originalText: 'original',
      correctedText: 'corrected',
      category: 'grammar',
      severity: 'medium',
      patternKey: 'some_pattern',
      type: 'mistake',
      createdAt: '2026-06-27T10:00:00.000Z',
    })
  })

  it('filters by startDate using a Timestamp', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] })
    await listEnglishMistakes('u1', { startDate: '2026-06-27' })
    expect(mockTimestampFromDate).toHaveBeenCalledWith(new Date('2026-06-27'))
    expect(mockQuery.where).toHaveBeenCalledWith(
      'createdAt',
      '>=',
      expect.objectContaining({ _type: 'Timestamp' })
    )
  })

  it('filters by endDate using next-day exclusive Timestamp', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] })
    await listEnglishMistakes('u1', { endDate: '2026-06-27' })
    const nextDay = new Date('2026-06-27')
    nextDay.setDate(nextDay.getDate() + 1)
    expect(mockTimestampFromDate).toHaveBeenCalledWith(nextDay)
    expect(mockQuery.where).toHaveBeenCalledWith(
      'createdAt',
      '<',
      expect.objectContaining({ _type: 'Timestamp' })
    )
  })

  it('filters by category in-memory', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [makeDoc('m1', 'grammar'), makeDoc('m2', 'phrasing')],
    })
    const result = await listEnglishMistakes('u1', { category: 'grammar' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('m1')
    expect(mockQuery.where).not.toHaveBeenCalledWith(
      'category',
      expect.anything(),
      expect.anything()
    )
  })

  it('uses custom limit when provided', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] })
    await listEnglishMistakes('u1', { limit: 10 })
    expect(mockQuery.limit).toHaveBeenCalledWith(10)
  })
})
