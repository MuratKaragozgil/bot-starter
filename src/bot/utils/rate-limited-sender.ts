import type { Context } from '#root/bot/context.js'
import type { Bot } from 'grammy'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { logger } from '#root/logger.js'

const MEMBERS_FILE = path.join(process.cwd(), 'members.json')

interface Member {
  id: number
  first_name?: string
  last_name?: string
  username?: string
}

function loadMembers(): Member[] {
  try {
    if (fs.existsSync(MEMBERS_FILE)) {
      const data = fs.readFileSync(MEMBERS_FILE, 'utf-8')
      const parsedData = JSON.parse(data)

      // Eğer direkt array ise
      if (Array.isArray(parsedData)) {
        return parsedData
      }

      // Eğer { members: [] } formatında ise
      if (parsedData.members && Array.isArray(parsedData.members)) {
        return parsedData.members
      }

      logger.warn('Invalid members.json format:', parsedData)
      return []
    }
  }
  catch (error) {
    logger.error('Error loading members:', error)
  }
  return []
}

export async function sendRateLimitedMessage(
  bot: Bot<Context>,
  message: string,
  options: {
    parse_mode?: 'HTML' | 'Markdown'
    link_preview_options?: { is_disabled: boolean }
  } = {},
): Promise<void> {
  const members = loadMembers()
  const delay = 35 // ms

  logger.info(`Starting to send message to ${members.length} members`)

  for (const member of members) {
    try {
      await bot.api.sendMessage(member.id, message, {
        parse_mode: options.parse_mode,
        link_preview_options: options.link_preview_options,
      })
      logger.info(
        `Message sent to member ${member.id} (${member.username || 'no username'})`,
      )

      // Belirtilen süre kadar bekle
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    catch (error) {
      logger.error(`Error sending message to member ${member.id}:`, error)
      // Hata durumunda da bekleme süresini koru
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  logger.info('Finished sending messages to all members')
}
