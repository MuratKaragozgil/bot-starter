import type { Context } from '#root/bot/context.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { isAdmin } from '#root/bot/filters/is-admin.js'
import { setCommandsHandler } from '#root/bot/handlers/commands/setcommands.js'
import { logHandle } from '#root/bot/helpers/logging.js'
import { logger } from '#root/logger.js'
import { chatAction } from '@grammyjs/auto-chat-action'
import { Composer } from 'grammy'

const composer = new Composer<Context>()

const feature = composer.chatType('private').filter(isAdmin)

feature.command(
  'setcommands',
  logHandle('command-setcommands'),
  chatAction('typing'),
  setCommandsHandler,
)

// Üye sayısını gösteren komut
feature.command('stats', async (ctx) => {
  try {
    const membersPath = path.join(process.cwd(), 'members.json')
    if (!fs.existsSync(membersPath)) {
      await ctx.reply('❌ members.json dosyası bulunamadı.')
      return
    }

    const data = fs.readFileSync(membersPath, 'utf-8')
    const members = JSON.parse(data)
    const totalMembers = members.length

    const message = [
      '📊 Bot İstatistikleri',
      `👥 Toplam Üye Sayısı: ${totalMembers}`,
      `⏰ Son Güncelleme: ${new Date().toLocaleString('tr-TR')}`,
    ].join('\n')

    await ctx.reply(message)
  }
  catch (error) {
    logger.error('Error in /stats command:', error)
    await ctx.reply('❌ İstatistikler alınırken bir hata oluştu.')
  }
})

export { composer as adminFeature }
