import type { Context } from '#root/bot/context.js'
import type { Config } from '#root/config.js'
import type { Logger } from '#root/logger.js'
import type { BotConfig } from 'grammy'
import { adminFeature } from '#root/bot/features/admin.js'
import { setupCronJob } from '#root/bot/features/cron.js'
import { languageFeature } from '#root/bot/features/language.js'
import { teslaFeature } from '#root/bot/features/tesla.js'
import { unhandledFeature } from '#root/bot/features/unhandled.js'
import { welcomeFeature } from '#root/bot/features/welcome.js'
import { errorHandler } from '#root/bot/handlers/error.js'
import { i18n, isMultipleLocales } from '#root/bot/i18n.js'
import { newUserMiddleware } from '#root/bot/middleware/new-user.js'
import { session } from '#root/bot/middlewares/session.js'
import { updateLogger } from '#root/bot/middlewares/update-logger.js'
import { logger } from '#root/logger.js'
import { autoChatAction } from '@grammyjs/auto-chat-action'
import { hydrate } from '@grammyjs/hydrate'
import { hydrateReply, parseMode } from '@grammyjs/parse-mode'
import { sequentialize } from '@grammyjs/runner'
import { MemorySessionStorage, Bot as TelegramBot } from 'grammy'

interface Dependencies {
  config: Config
  logger: Logger
}

function getSessionKey(ctx: Omit<Context, 'session'>) {
  return ctx.chat?.id.toString()
}

// Bot komutlarını ayarla
async function setupCommands(bot: TelegramBot<Context>) {
  try {
    await bot.api.setMyCommands(
      [
        {
          command: 'start',
          description: 'Botu başlat / Start the bot',
        },
        {
          command: 'check',
          description: 'Tesla envanterini kontrol et / Check Tesla inventory',
        },
      ],
      {
        scope: {
          type: 'all_private_chats',
        },
        language_code: 'tr',
      },
    )

    await bot.api.setMyCommands(
      [
        {
          command: 'start',
          description: 'Start the bot',
        },
        {
          command: 'check',
          description: 'Check Tesla inventory',
        },
      ],
      {
        scope: {
          type: 'all_private_chats',
        },
        language_code: 'en',
      },
    )

    logger.info('✅ Bot commands set successfully')
  }
  catch (error) {
    logger.error('❌ Error setting bot commands:', error)
  }
}

// Adminlere bot başlangıç bildirimi gönder
async function sendStartupNotification(
  bot: TelegramBot<Context>,
  config: Config,
) {
  try {
    const startupTime = new Date().toLocaleString('tr-TR')
    const message = [
      '🚀 Bot Başlatıldı',
      `⏰ Tarih: ${startupTime}`,
      `📊 Mod: ${config.isDebug ? 'Debug' : 'Production'}`,
      `🔄 Polling: ${config.isPollingMode ? 'Açık' : 'Kapalı'}`,
    ].join('\n')

    for (const adminId of config.botAdmins) {
      try {
        await bot.api.sendMessage(adminId, message)
        logger.info(`✅ Startup notification sent to admin ${adminId}`)
      }
      catch (error) {
        logger.error(
          `❌ Error sending startup notification to admin ${adminId}:`,
          error,
        )
      }
    }
  }
  catch (error) {
    logger.error('❌ Error in startup notification:', error)
  }
}

export function createBot(
  token: string,
  dependencies: Dependencies,
  botConfig?: BotConfig<Context>,
) {
  const { config, logger } = dependencies

  const bot = new TelegramBot<Context>(token, botConfig)

  bot.use(async (ctx, next) => {
    ctx.config = config
    ctx.logger = logger.child({
      update_id: ctx.update.update_id,
    })

    await next()
  })

  const protectedBot = bot.errorBoundary(errorHandler)

  // Middlewares
  bot.api.config.use(parseMode('HTML'))

  if (config.isPollingMode)
    protectedBot.use(sequentialize(getSessionKey))
  if (config.isDebug)
    protectedBot.use(updateLogger())
  protectedBot.use(autoChatAction(bot.api))
  protectedBot.use(hydrateReply)
  protectedBot.use(hydrate())
  protectedBot.use(
    session({
      getSessionKey,
      storage: new MemorySessionStorage(),
    }),
  )
  protectedBot.use(i18n)
  protectedBot.use(newUserMiddleware)

  // Handlers
  protectedBot.use(welcomeFeature)
  protectedBot.use(adminFeature)
  protectedBot.use(teslaFeature)
  if (isMultipleLocales)
    protectedBot.use(languageFeature)

  // must be the last handler
  protectedBot.use(unhandledFeature)

  // Setup cron job
  setupCronJob(bot)

  // Setup bot commands
  setupCommands(bot)

  // Send startup notification
  sendStartupNotification(bot, config)

  logger.info('Bot started successfully')

  return bot
}

export type Bot = ReturnType<typeof createBot>
