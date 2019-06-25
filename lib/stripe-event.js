const _ = require('lodash')

const rollbar = require('./rollbar')

module.exports = stripeEvent
module.exports.attributes = {
  name: 'stripe'
}

function stripeEvent (server, { env, channel }, next) {
  server.route({
    method: 'POST',
    path: '/stripe',
    handler
  })

  async function handler (request, reply) {
    if (!_.get(request, 'payload.id')) return reply({ error: 'id missing' }).code(400)

    const job = {
      name: 'stripe-event',
      id: request.payload.id
    }

    try {
      await channel.sendToQueue(env.QUEUE_NAME, Buffer.from(JSON.stringify(job)), { priority: 5 })
    } catch (err) {
      rollbar.error(err, _.assign({}, request.raw.req, {
        socket: {
          encrypted: request.server.info.protocol === 'https'
        },
        connection: {
          remoteAddress: request.info.remoteAddress
        }
      }))
      return reply({ error: true }).code(500)
    }

    reply({ ok: true }).code(202)
  }

  next()
}
