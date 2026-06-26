import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt'
import passport from 'passport'
import { prisma } from '../lib/prisma.js'
import { config } from '../config.js'

const opts = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: config.jwtSecret,
}

passport.use(
  new JwtStrategy(opts, async (payload, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: payload.sub } })
      if (user) return done(null, user)
      return done(null, false)
    } catch (err) {
      return done(err, false)
    }
  })
)

export default passport
