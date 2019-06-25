const crypto = require('crypto')

const amqp = require('amqplib')
const hapi = require('hapi')
const tap = require('tap')
const nock = require('nock')

const env = require('../lib/env')
const register = require('../lib/nexus-event')

;(async () => {
  const conn = await amqp.connect(env.AMQP_URL)
  const channel = await conn.createChannel()
  await channel.assertQueue(env.QUEUE_NAME, {
    maxPriority: 5
  })

  process.env.NEXUS_SECRET = 'test'
  process.env.NEXUS_URL = 'http://127.0.0.1:8081/repository'
  process.env.NEXUS_REPOSITORY = 'my-npm'
  process.env.NEXUS_INSTALLATION = '1'

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
      options: { env }
    })

    server.inject({
      method: 'POST',
      url: '/nexus/'
    }, ({ statusCode }) => {
      t.is(statusCode, 403, 'statusCode')
      t.end()
    })
  })

  tap.test('stores handled and signed event in queue', async (t) => {
    const reqPayload = JSON.stringify({
      action: 'CREATED',
      asset: {
        name: '@test/test/-/@test/test-1.0.0.tgz'
      }
    })

    server.register({
      register,
      options: { env, channel }
    })

    const installation = '1'

    const hmacPayload = crypto.createHmac('sha1', env.NEXUS_SECRET)
      .update(reqPayload)
      .digest('hex')

    nock('http://127.0.0.1:8081')
      .get('/repository/my-npm/@test/test')
      .reply(200, {
        'dist-tags': {
          latest: '1.0.0'
        },
        versions: {
          '1.0.0': {}
        }
      })

    const { statusCode, payload } = await server.inject({
      method: 'POST',
      url: `/nexus/`,
      headers: {
        'x-nexus-webhook-signature': `${hmacPayload}`,
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
      registry: 'http://127.0.0.1:8081/repository'
    }, 'job data')
    t.same(job.properties.priority, 1, 'job priority')
    t.end()
  })

  tap.test('accepts packages that are bigger then 1MB', async (t) => {
    const bigBody = Buffer.alloc(1024 * 1024 * 3).toString()
    const reqPayload = JSON.stringify({
      action: 'CREATED',
      asset: {
        name: '@test/test/-/@test/test-1.0.0.tgz'
      },
      bigBody
    })

    const payloadSize = reqPayload.length

    server.register({
      register,
      options: { env, channel }
    })

    const hmacPayload = crypto.createHmac('sha1', env.NEXUS_SECRET)
      .update(reqPayload)
      .digest('hex')

    nock('http://127.0.0.1:8081')
      .get('/repository/my-npm/@test/test')
      .reply(200, {
        'dist-tags': {
          latest: '1.0.0'
        },
        versions: {
          '1.0.0': {}
        }
      })

    const { statusCode, payload } = await server.inject({
      method: 'POST',
      url: `/nexus/`,
      headers: {
        'x-nexus-webhook-signature': `${hmacPayload}`,
        'Content-Type': 'application/json'
      },
      payload: reqPayload
    })

    t.is(statusCode, 202, 'statusCode')
    t.true(JSON.parse(payload).ok, 'payload')

    t.true((payloadSize > 1024 * 1024 * 1), 'payload is bigger then 1MB')
    t.true((payloadSize < 1024 * 1024 * 25), 'payload is smaller then 25MB')
    t.is(statusCode, 202, 'statusCode')
    t.end()
  })

  tap.test('does not accept packages that are bigger then 25MB', async (t) => {
    const bigBody = Buffer.alloc(1024 * 1024 * 5).toString()
    const reqPayload = JSON.stringify({
      action: 'CREATED',
      asset: {
        name: '@test/test/-/@test/test-1.0.0.tgz'
      },
      bigBody
    })

    const payloadSize = reqPayload.length

    server.register({
      register,
      options: { env, channel }
    })

    const hmacPayload = crypto.createHmac('sha1', env.NEXUS_SECRET)
      .update(reqPayload)
      .digest('hex')

    nock('http://127.0.0.1:8081')
      .get('/repository/my-npm/@test/test')
      .reply(200, {
        'dist-tags': {
          latest: '1.0.0'
        },
        versions: {
          '1.0.0': {}
        }
      })

    const { statusCode } = await server.inject({
      method: 'POST',
      url: `/nexus/`,
      headers: {
        'x-nexus-webhook-signature': `${hmacPayload}`,
        'Content-Type': 'application/json'
      },
      payload: reqPayload
    })

    t.true((payloadSize > 1024 * 1024 * 25), 'payload is bigger then 25MB')
    t.is(statusCode, 413, 'statusCode')
    t.end()
  })
})()
