const _ = require('lodash')
const Boom = require('boom')

const rollbar = require('./rollbar')

module.exports = deprecateNodeEvent
module.exports.attributes = {
  name: 'deprecateNode'
}

function deprecateNodeEvent (server, { env, channel }, next) {
  server.route({
    method: 'POST',
    path: '/deprecate-node',
    config: {
      pre: [{ method: (request, reply) => {
        if (request.headers['bearer-token'] === env.BEARER_TOKEN) {
          return reply.continue()
        }
        return reply(Boom.unauthorized())
      } }]
    },
    handler
  })

  async function handler (request, reply) {
    if (!_.get(request, 'payload.repositoryFullName')) return reply({ error: 'repositoryFullName missing' }).code(400)
    if (!_.get(request, 'payload.nodeVersion')) return reply({ error: 'nodeVersion missing' }).code(400)
    if (!_.get(request, 'payload.codeName')) return reply({ error: 'codeName missing' }).code(400)
    if (!_.get(request, 'payload.newLowestVersion')) return reply({ error: 'newLowestVersion missing' }).code(400)
    if (!_.get(request, 'payload.newLowestCodeName')) return reply({ error: 'newLowestCodeName missing' }).code(400)
    // `request.payload.announcementURL` is optional

    const job = {
      name: 'deprecate-nodejs-version',
      repositoryFullName: request.payload.repositoryFullName,
      nodeVersion: request.payload.nodeVersion,
      codeName: request.payload.codeName,
      newLowestVersion: request.payload.newLowestVersion,
      newLowestCodeName: request.payload.newLowestCodeName,
      announcementURL: request.payload.announcementURL ? request.payload.announcementURL : undefined
    }

    try {
      await channel.sendToQueue(env.QUEUE_NAME, Buffer.from(JSON.stringify(job)), { priority: 3 })
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
