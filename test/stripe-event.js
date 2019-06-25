const amqp = require('amqplib')
const hapi = require('hapi')
const tap = require('tap')

const env = require('../lib/env')
const register = require('../lib/stripe-event')

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

  tap.test('rejects without payload', async (t) => {
    server.register({
      register,
      options: { env }
    })

    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/stripe'
    })
    t.is(statusCode, 400, 'statusCode')
    t.end()
  })

  tap.test('stores event in queue', async (t) => {
    server.register({
      register,
      options: { env, channel }
    })

    const reqPayload = JSON.stringify({ id: 'eventid' })

    const { statusCode, payload } = await server.inject({
      method: 'POST',
      url: '/stripe',
      headers: {
        'Content-Type': 'application/json'
      },
      payload: reqPayload
    })
    t.is(statusCode, 202, 'statusCode')
    t.true(JSON.parse(payload).ok, 'payload')
    const job = await channel.get(env.QUEUE_NAME)
    t.same(JSON.parse(job.content.toString()), {
      name: 'stripe-event',
      id: 'eventid'
    })
    t.same(job.properties.priority, 5, 'job priority')
    t.end()
  })
})()
