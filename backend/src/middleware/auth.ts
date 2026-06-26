import { Request, Response, NextFunction } from 'express'
import passport from 'passport'
import { prisma } from '../lib/prisma.js'

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('jwt', { session: false }, (err: any, user: any) => {
    if (err) return next(err)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    req.user = user
    next()
  })(req, res, next)
}

/** MVP 过渡：有 token 就验证并绑定用户，没有就用默认用户 1 */
export const optionalAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    const user = await prisma.user.findFirst()
    if (user) (req as any).user = user
    return next()
  }

  passport.authenticate('jwt', { session: false }, (_err: any, user: any) => {
    if (user) req.user = user
    next()
  })(req, _res, next)
}
