import type { Context } from '#root/bot/context.js'
import { logHandle } from '#root/bot/helpers/logging.js'
import { Composer } from 'grammy'
import { i18n } from '#root/bot/i18n.js'
import { logger } from '#root/logger.js'
import fs from 'fs'
import path from 'path'

interface Member {
  id: number
  username?: string
  first_name: string
  last_name?: string
  last_seen: number
}

const MEMBERS_FILE = path.join(process.cwd(), 'members.json')

function loadMembers(): Member[] {
  try {
    if (fs.existsSync(MEMBERS_FILE)) {
      const data = fs.readFileSync(MEMBERS_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    logger.error('Error loading members:', error)
  }
  return []
}

function saveMembers(members: Member[]) {
  try {
    fs.writeFileSync(MEMBERS_FILE, JSON.stringify(members, null, 2))
  } catch (error) {
    logger.error('Error saving members:', error)
  }
}

function updateMember(member: Member) {
  const members = loadMembers()
  const existingMemberIndex = members.findIndex(m => m.id === member.id)
  
  if (existingMemberIndex >= 0) {
    // Update existing member
    members[existingMemberIndex] = {
      ...members[existingMemberIndex],
      ...member,
      last_seen: Date.now()
    }
  } else {
    // Add new member
    members.push({
      ...member,
      last_seen: Date.now()
    })
  }
  
  saveMembers(members)
}

const composer = new Composer<Context>()

const feature = composer.chatType('private')

feature.command('start', logHandle('command-start'), async (ctx) => {
  if (!ctx.from) return

  // Update member information
  updateMember({
    id: ctx.from.id,
    username: ctx.from.username,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name,
    last_seen: Date.now()
  })

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
