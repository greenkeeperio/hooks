const envalid = require('envalid')
const {str, num, url} = envalid

module.exports = envalid.cleanEnv(process.env, {
  PORT: num({default: 8000}),
  WEBHOOKS_SECRET: str({devDefault: 'YOLO'}),
  NPMHOOKS_SECRET: str({devDefault: 'SWAG'}),
  QUEUE_NAME: str({default: 'events'}),
  AMQP_URL: url({devDefault: 'amqp://localhost?heartbeat=15'}),
  NODE_ENV: str({choices: ['development', 'staging', 'production'], devDefault: 'development'}),
  ROLLBAR_TOKEN_HOOKS: str({devDefault: ''}),
  STATSD_HOST: str({default: '172.17.0.1'}),
  BEARER_TOKEN: str({devDefault: 'PIZZA'})
})
