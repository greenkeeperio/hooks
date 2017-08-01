const _ = require('lodash')
const Boom = require('boom')

const rollbar = require('./rollbar')

module.exports = resetEvent
module.exports.attributes = {
  name: 'reset'
}

function resetEvent (server, {env, channel}, next) {
  server.route({
    method: 'POST',
    path: '/reset',
    config: {
      pre: [{method: (request, reply) => {
        if (request.headers['bearer-token'] === env.BEARER_TOKEN) {
          return reply.continue()
        }
        return reply(Boom.unauthorized())
      }}]
    },
    handler
  })

  async function handler (request, reply) {
    if (!_.get(request, 'payload.repositoryFullName')) return reply({error: 'repositoryFullName missing'}).code(400)

    const job = {
      name: 'reset',
      repositoryFullName: request.payload.repositoryFullName
    }

    try {
      await channel.sendToQueue(env.QUEUE_NAME, Buffer.from(JSON.stringify(job)), {priority: 5})
    } catch (err) {
      rollbar.error(err, _.assign({}, request.raw.req, {
        socket: {
          encrypted: request.server.info.protocol === 'https'
        },
        connection: {
          remoteAddress: request.info.remoteAddress
        }
      }))
      return reply({error: true}).code(500)
    }

    reply({ok: true}).code(202)
  }

  next()
}
