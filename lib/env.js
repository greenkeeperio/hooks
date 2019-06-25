const envalid = require('envalid')
const { str, num, url, bool } = envalid

module.exports = envalid.cleanEnv(process.env, {
  PORT: num({ default: 5000 }),
  WEBHOOKS_SECRET: str({ devDefault: 'YOLO' }),
  NPMHOOKS_SECRET: str({ devDefault: 'SWAG' }),
  QUEUE_NAME: str({ default: 'events' }),
  AMQP_URL: url({ devDefault: 'amqp://localhost?heartbeat=15' }),
  NODE_ENV: str({ choices: ['development', 'staging', 'production'], devDefault: 'development' }),
  ROLLBAR_TOKEN_HOOKS: str({ devDefault: '' }),
  STATSD_HOST: str({ default: '172.17.0.1' }),
  BEARER_TOKEN: str({ devDefault: 'PIZZA' }),
  IS_ENTERPRISE: bool({ default: false }),
  NEXUS_SECRET: str({ devDefault: 'test', default: '' }),
  NEXUS_URL: str({ devDefault: 'http://127.0.0.1:8081/repository', default: '' }),
  NEXUS_REPOSITORY: str({ devDefault: 'my-npm', default: '' }),
  NEXUS_INSTALLATION: str({ devDefault: '1', default: '' })
})
