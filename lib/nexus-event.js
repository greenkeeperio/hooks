const crypto = require('crypto')

const fetch = require('node-fetch')
const _ = require('lodash')

const rollbar = require('./rollbar')

module.exports = nexusEvent
module.exports.attributes = {
  name: 'nexus'
}

function nexusEvent (server, { env, channel }, next) {
  server.route({
    method: 'POST',
    path: '/nexus/',
    handler,
    config: {
      payload: {
        output: 'data',
        parse: false,
        maxBytes: 1024 * 1024 * 25 // = 25 MB
      }
    }
  })

  async function handler (request, reply) {
    const nexusSecret = env.NEXUS_SECRET
    const nexusUrl = env.NEXUS_URL
    const nexusRepository = env.NEXUS_REPOSITORY
    const nexusInstallation = env.NEXUS_INSTALLATION

    if (!nexusSecret || !nexusUrl || !nexusRepository || !nexusInstallation) {
      return reply({ ok: false }).code(503) // Service Unavailable
    }

    const payload = request.payload.toString()
    const signature = request.headers['x-nexus-webhook-signature']

    var hmacDigest = crypto.createHmac('sha1', nexusSecret)
      .update(payload)
      .digest('hex')

    if (signature !== hmacDigest) {
      return reply({ ok: false }).code(403)
    }

    let update
    try {
      update = JSON.parse(payload)
      // we can only parse out the version on here
      if (update.action !== 'CREATED') {
        return reply({ ok: true }).code(200)
      }
    } catch (e) {
      console.log(e)
      return reply({ error: true }).code(401)
    }

    const name = update.asset.name.split('/-/')[0]
    // const version = update.asset.name.match(/-(\d+\.\d+\.\d+.*)\.tgz/)[1]

    const docUrl = `${nexusUrl}/${nexusRepository}/${name}`

    let doc
    try {
      doc = await (await fetch(docUrl)).json()
    } catch (e) {
      console.log('doc fetch error', e)
      throw (e)
    }

    const versions = _.mapValues(doc.versions, v => _.pick(v, ['gitHead', 'repository']))

    const job = {
      name: 'registry-change',
      dependency: name,
      installation: nexusInstallation,
      distTags: doc['dist-tags'],
      versions: versions,
      registry: nexusUrl
    }

    try {
      await channel.sendToQueue(env.QUEUE_NAME, Buffer.from(JSON.stringify(job)), { priority: 1 })
    } catch (err) {
      console.log('rollbar', err)
      rollbar.error(err, _.assign({}, request.raw.req, {
        socket: {
          encrypted: request.server.info.protocol === 'https'
        },
        connection: {
          remoteAddress: request.info.remoteAddress
        }
      }))
      return reply({ error: true }).code(501)
    }

    reply({ ok: true }).code(202)
  }
  next()
}
