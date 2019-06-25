const crypto = require('crypto')

const _ = require('lodash')

const rollbar = require('./rollbar')

const githubEvents = {
  push: {
    priority: 3
  },
  status: {
    priority: 2
  },
  integration_check_run: {
    priority: 2
  },
  integration_installation: {
    created: {
      priority: 3
    },
    deleted: {
      priority: 5
    }
  },
  integration_installation_repositories: {
    priority: 4
  },
  integration_issues: {
    priority: 2
  },
  integration_marketplace_purchase: {
    priority: 4
  },
  integration_pull_request: {
    priority: 2
  },
  public: {
    priority: 3
  }
}

const blacklist = [
  'delete',
  'issue_comment',
  'public',
  'pull_request_review_comment',
  'pull_request_review'
]

module.exports = githubEvent
module.exports.attributes = {
  name: 'github'
}

function githubEvent (server, { env, channel }, next) {
  server.route({
    method: 'POST',
    path: '/github',
    handler,
    config: {
      payload: {
        output: 'data',
        parse: false
      }
    }
  })

  async function handler (request, reply) {
    const eventName = request.headers['x-github-event']

    if (_.includes(blacklist, eventName)) return reply({ ok: true }).code(202)

    const event = githubEvents[eventName] || {
      priority: 1
    }

    const { payload } = request
    const hmacPayload = crypto.createHmac('sha1', env.WEBHOOKS_SECRET)
      .update(payload)
      .digest('hex')

    const signature = request.headers['x-hub-signature']
    if (`sha1=${hmacPayload}` !== signature) {
      return reply({ error: true }).code(403)
    }

    const parsedPayload = JSON.parse(payload.toString())
    parsedPayload.name = 'github-event'
    parsedPayload.type = eventName

    const options = _.get(event, [parsedPayload.action], event)

    try {
      await channel.sendToQueue(env.QUEUE_NAME, Buffer.from(JSON.stringify(parsedPayload)), options)
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
