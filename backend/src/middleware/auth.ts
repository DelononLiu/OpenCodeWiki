import { Request, Response, NextFunction } from 'express'
import passport from 'passport'

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('jwt', { session: false }, (err: any, user: any) => {
    if (err) return next(err)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    req.user = user
    next()
  })(req, res, next)
}
