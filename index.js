const amqp = require('amqplib')
const hapi = require('hapi')
const StatsD = require('hot-shots')

const env = require('./lib/env')
require('./lib/rollbar')

;(async () => {
  const statsdClient = new StatsD({
    host: env.STATSD_HOST,
    prefix: 'hooks.',
    globalTags: [env.NODE_ENV]
  })
  const server = new hapi.Server({
    debug: {
      log: ['error', 'requested'],
      request: ['error', 'requested', 'request']
    }
  })
  const conn = await amqp.connect(env.AMQP_URL)
  const channel = await conn.createChannel()
  await channel.assertQueue(env.QUEUE_NAME, {
    maxPriority: 5
  })

  server.connection({
    port: env.PORT
  })

  server.route({
    method: 'GET',
    path: '/',
    handler: (request, reply) => reply('OK').type('text/plain')
  })

  await server.register([{
    register: require('./lib/github-event'),
    options: {
      env,
      channel
    }
  }, {
    register: require('./lib/npm-event'),
    options: {
      env,
      channel
    }
  }, {
    register: require('./lib/stripe-event'),
    options: {
      env,
      channel
    }
  }, {
    register: require('./lib/reset-event'),
    options: {
      env,
      channel
    }
  }, {
    register: require('./lib/sync-event'),
    options: {
      env,
      channel
    }
  }, {
    register: require('./lib/update-node-event'),
    options: {
      env,
      channel
    }
  }, {
    register: require('./lib/deprecate-node-event'),
    options: {
      env,
      channel
    }
  }, {
    register: require('good'),
    options: {
      reporters: {
        myConsoleReporter: [
          {
            module: 'good-squeeze',
            name: 'Squeeze',
            args: [{
              log: '*',
              response: '*'
            }]
          },
          {
            module: 'good-console'
          },
          'stdout']
      }
    }
  }])

  if (env.IS_ENTERPRISE && env.NEXUS_SECRET && env.NEXUS_URL && env.NEXUS_REPOSITORY && env.NEXUS_INSTALLATION) {
    await server.register({
      register: require('./lib/nexus-event'),
      options: {
        env,
        channel
      }
    })
  }

  server.on('response', (request, reply) => {
    statsdClient.increment(`status_code.${request.response.statusCode}`)
    statsdClient.timing('response_time', Date.now() - request.info.received)
  })

  await server.start()
  console.log('server running', server.info.uri)
})()
