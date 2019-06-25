const crypto = require('crypto')

const amqp = require('amqplib')
const hapi = require('hapi')
const tap = require('tap')

const env = require('../lib/env')
const register = require('../lib/github-event')

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
      options: { env }
    })

    server.inject({
      method: 'POST',
      url: '/github',
      headers: { 'x-github-event': 'push' }
    }, ({ statusCode }) => {
      t.is(statusCode, 403, 'statusCode')
      t.end()
    })
  })

  tap.test('ignores blacklisted event', (t) => {
    server.register({
      register,
      options: { env }
    })

    server.inject({
      method: 'POST',
      url: '/github',
      headers: { 'x-github-event': 'delete' }
    }, ({ statusCode }) => {
      t.is(statusCode, 202, 'statusCode')
      t.end()
    })
  })

  tap.test('stores handled and signed event in queue', async (t) => {
    t.plan(4)
    const reqPayload = JSON.stringify({ data: true })

    server.register({
      register,
      options: { env, channel }
    })

    const hmacPayload = crypto.createHmac('sha1', env.WEBHOOKS_SECRET)
      .update(reqPayload)
      .digest('hex')

    const { statusCode, payload } = await server.inject({
      method: 'POST',
      url: '/github',
      headers: {
        'x-github-event': 'push',
        'x-hub-signature': `sha1=${hmacPayload}`,
        'Content-Type': 'application/json'
      },
      payload: reqPayload
    })

    t.is(statusCode, 202, 'statusCode')
    t.true(JSON.parse(payload).ok, 'payload')

    const job = await channel.get(env.QUEUE_NAME)

    t.same(JSON.parse(job.content.toString()), {
      name: 'github-event',
      type: 'push',
      data: true
    }, 'job data')
    t.same(job.properties.priority, 3, 'job priority')
  })

  tap.test('get default priority for unknown jobs', async (t) => {
    t.plan(4)
    const reqPayload = JSON.stringify({ data: true })

    server.register({
      register,
      options: {
        env,
        channel
      }
    })

    const hmacPayload = crypto.createHmac('sha1', env.WEBHOOKS_SECRET)
      .update(reqPayload)
      .digest('hex')

    const { statusCode, payload } = await server.inject({
      method: 'POST',
      url: '/github',
      headers: {
        'x-github-event': 'whatever_lol',
        'x-hub-signature': `sha1=${hmacPayload}`,
        'Content-Type': 'application/json'
      },
      payload: reqPayload
    })

    t.is(statusCode, 202, 'statusCode')
    t.true(JSON.parse(payload).ok, 'payload')

    const job = await channel.get(env.QUEUE_NAME)

    t.same(JSON.parse(job.content.toString()), {
      name: 'github-event',
      type: 'whatever_lol',
      data: true
    }, 'job data')
    t.same(job.properties.priority, 1, 'job priority')
  })

  tap.test('get correct priority for known jobs', async (t) => {
    t.plan(4)
    const reqPayload = JSON.stringify({ action: 'deleted' })

    server.register({
      register,
      options: {
        env,
        channel
      }
    })

    const hmacPayload = crypto.createHmac('sha1', env.WEBHOOKS_SECRET)
      .update(reqPayload)
      .digest('hex')

    const { statusCode, payload } = await server.inject({
      method: 'POST',
      url: '/github',
      headers: {
        'x-github-event': 'integration_installation',
        'x-hub-signature': `sha1=${hmacPayload}`,
        'Content-Type': 'application/json'
      },
      payload: reqPayload
    })

    t.is(statusCode, 202, 'statusCode')
    t.true(JSON.parse(payload).ok, 'payload')

    const job = await channel.get(env.QUEUE_NAME)

    t.same(JSON.parse(job.content.toString()), {
      name: 'github-event',
      type: 'integration_installation',
      action: 'deleted'
    }, 'job data')
    t.same(job.properties.priority, 5, 'job priority')
  })
})()
