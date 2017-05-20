const crypto = require('crypto')

const amqp = require('amqplib')
const hapi = require('hapi')
const tap = require('tap')

const env = require('../lib/env')
const register = require('../lib/npm-event')

;(async () => {
  const conn = await amqp.connect(env.AMQP_URL)
  const channel = await conn.createChannel()
  await channel.assertQueue(env.QUEUE_NAME, {
    maxPriority: 5
  })

  let server
  tap.beforeEach(done => {
    server = new hapi.Server()
    server.connection()
    done()
  })

  // w/o `.then` everthing blows up ¯\_(ツ)_/¯
  tap.afterEach(() => channel.purgeQueue().then(() => {}))

  tap.tearDown(async () => {
    channel.reply = null // not sure why there is an outstanding reply
    await conn.close()
  })

  tap.test('rejects without correct signature', (t) => {
    server.register({
      register,
      options: {env}
    })

    server.inject({
      method: 'POST',
      url: '/npm/123'
    }, ({statusCode}) => {
      t.is(statusCode, 403, 'statusCode')
      t.end()
    })
  })

  tap.test('stores handled and signed event in queue', async (t) => {
    const reqPayload = JSON.stringify({payload: {
      name: '@test/test',
      'dist-tags': {
        latest: '1.0.0'
      },
      versions: {
        '1.0.0': {}
      }
    }})

    server.register({
      register,
      options: {env, channel}
    })

    const installation = '123'
    const secret = crypto.createHmac('sha256', env.NPMHOOKS_SECRET)
    .update(installation)
    .digest('hex')

    const hmacPayload = crypto.createHmac('sha256', secret)
    .update(reqPayload)
    .digest('hex')

    const {statusCode, payload} = await server.inject({
      method: 'POST',
      url: `/npm/${installation}`,
      headers: {
        'x-npm-signature': `sha256=${hmacPayload}`,
        'Content-Type': 'application/json'
      },
      payload: reqPayload
    })

    t.is(statusCode, 202, 'statusCode')
    t.true(JSON.parse(payload).ok, 'payload')

    const job = await channel.get(env.QUEUE_NAME)

    t.same(JSON.parse(job.content.toString()), { name: 'registry-change',
      dependency: '@test/test',
      installation,
      distTags: { latest: '1.0.0' },
      versions: { '1.0.0': {} },
      registry: 'https://registry.npmjs.com'
    }, 'job data')
    t.same(job.properties.priority, 1, 'job priority')
    t.end()
  })
})()
