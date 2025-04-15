import type { Context } from '#root/bot/context.js'
import { logHandle } from '#root/bot/helpers/logging.js'
import { Composer } from 'grammy'

const composer = new Composer<Context>()

const feature = composer.chatType('private')

feature.command('start', logHandle('command-start'), async (ctx) => {
  if (!ctx.from) return

  const message = `👋 Merhaba! Ben Tesla Model Y Envanter Botu'yum.\n\n` +
    `🤖 Ne Yapabilirim?\n` +
    `• Tesla Model Y envanterini kontrol edebilirim\n` +
    `• Mevcut araçların detaylı bilgilerini gösterebilirim\n` +
    `• Fiyat ve özellik bilgilerini paylaşabilirim\n\n` +
    `📋 Komutlar:\n` +
    `/check - Tesla Model Y envanterini kontrol et\n\n` +
    `ℹ️ Bot, Tesla'nın resmi envanter API'sini kullanarak güncel bilgileri gösterir.\n` +
    `Her araç için fiyat, renk, iç mekan, jant, hızlanma ve menzil bilgilerini görebilirsiniz.\n\n` +
    `🔔 Not: Veriler Tesla'nın resmi web sitesinden alınmaktadır ve gerçek zamanlıdır.`

  await ctx.reply(message, {
    parse_mode: 'HTML',
    link_preview_options: {
      is_disabled: true
    }
  })
})

export { composer as welcomeFeature }
