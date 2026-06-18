import type { Request, Response, NextFunction } from 'express'
import { getAuth } from 'firebase-admin/auth'

declare global {
  namespace Express {
    interface Request {
      uid?: string
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.split('Bearer ')[1]
  if (!token) {
    res.status(401).json({ error: 'Missing token' })
    return
  }
  try {
    const decoded = await getAuth().verifyIdToken(token)
    if (!decoded.email || decoded.email !== process.env.ALLOWED_EMAIL) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    req.uid = decoded.uid
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}
