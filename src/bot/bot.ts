import type { Context } from '#root/bot/context.js'
import { teslaFeature } from '#root/bot/features/tesla.js'
import { welcomeFeature } from '#root/bot/features/welcome.js'
import { newUserMiddleware } from '#root/bot/middleware/new-user.js'
import { config } from '#root/config.js'
import { logger } from '#root/logger.js'
import { Bot } from 'grammy'

export const bot = new Bot<Context>(config.botToken)

// Bot komutlarını ayarla
async function setupCommands() {
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

// Global middleware
bot.use(newUserMiddleware)

// Features
bot.use(welcomeFeature)
bot.use(teslaFeature)

// Komutları ayarla
setupCommands()

logger.info('Bot started successfully')
