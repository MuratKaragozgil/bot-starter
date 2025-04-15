import { config } from '#root/config.js'
import { pino } from 'pino'

export const logger = pino({
  level: config.logLevel,
  transport: {
    targets: [
      ...(config.isDebug
        ? [
            {
              target: 'pino-pretty',
              level: config.logLevel,
              options: {
                ignore: 'pid,hostname',
                colorize: true,
                translateTime: true,
                singleLine: false,
                messageFormat: '{msg} {if err}{err.message}{end} {if obj}{obj}{end}'
              },
            },
          ]
        : [
            {
              target: 'pino/file',
              level: config.logLevel,
              options: {
                destination: 1, // stdout
                mkdir: true
              },
            },
          ]),
    ],
  },
})

export type Logger = typeof logger
