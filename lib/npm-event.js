const crypto = require('crypto')
const _ = require('lodash')
const rollbar = require('./rollbar')

module.exports = npmEvent
module.exports.attributes = {
  name: 'npm'
}

function npmEvent (server, { env, channel }, next) {
  server.route({
    method: 'POST',
    path: '/npm/{installation}',
    handler,
    config: {
      payload: {
        output: 'data',
        parse: false,
        maxBytes: 1024 * 1024 * 100 // = 100 MB
      }
    }
  })

  async function handler (request, reply) {
    const installation = request.params.installation
    const secret = crypto.createHmac('sha256', env.NPMHOOKS_SECRET)
      .update(installation)
      .digest('hex')

    const { payload } = request
    const hmacPayload = crypto.createHmac('sha256', secret)
      .update(payload)
      .digest('hex')

    const signature = request.headers['x-npm-signature']
    if (`sha256=${hmacPayload}` !== signature) {
      return reply({ error: true }).code(403)
    }

    var parsedPayload, distTags, versions
    try {
      parsedPayload = JSON.parse(payload.toString()).payload
      distTags = parsedPayload['dist-tags']
      versions = _.mapValues(parsedPayload.versions, version => _.pick(version, ['gitHead', 'repository', 'license', '_npmUser']))
    } catch (e) {
      return reply({ error: true }).code(401)
    }

    const job = {
      name: 'registry-change',
      dependency: parsedPayload.name,
      installation,
      distTags,
      versions,
      registry: 'https://registry.npmjs.com'
    }

    try {
      await channel.sendToQueue(env.QUEUE_NAME, Buffer.from(JSON.stringify(job)), { priority: 1 })
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
