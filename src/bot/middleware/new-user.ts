import { Composer } from 'grammy';
import type { Context } from '#root/bot/context.js';
import { logger } from '#root/logger.js';
import fs from 'fs';
import path from 'path';
import { config } from '#root/config.js';

const composer = new Composer<Context>();

interface Member {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

// Kullanıcı verilerini yükle
function loadMembers(): Member[] {
  try {
    const membersPath = path.join(process.cwd(), 'members.json');
    logger.info('🔍 Loading members from:', membersPath);
    
    if (!fs.existsSync(membersPath)) {
      logger.warn('⚠️ members.json does not exist, creating new file');
      fs.writeFileSync(membersPath, '[]');
      return [];
    }
    
    const data = fs.readFileSync(membersPath, 'utf-8');
    const members = JSON.parse(data);
    logger.info('📋 Loaded members:', members);
    return members;
  } catch (error) {
    logger.error('❌ Error loading members:', error);
  }
  return [];
}

// Kullanıcı verilerini kaydet
function saveMembers(members: Member[]) {
  try {
    const membersPath = path.join(process.cwd(), 'members.json');
    logger.info('💾 Saving members to:', membersPath);
    logger.info('📝 Members to save:', members);
    
    fs.writeFileSync(membersPath, JSON.stringify(members, null, 2));
    logger.info('✅ Members saved successfully');
    
    // Kaydedilen dosyayı kontrol et
    const savedData = fs.readFileSync(membersPath, 'utf-8');
    const savedMembers = JSON.parse(savedData);
    logger.info('🔍 Verified saved members:', savedMembers);
  } catch (error) {
    logger.error('❌ Error saving members:', error);
  }
}

// Yeni kullanıcı kontrolü için middleware
composer.use(async (ctx, next) => {
  logger.info('🔄 Middleware triggered');
  logger.info('📦 Update type:', ctx.update);
  
  if (!ctx.from) {
    logger.info('⚠️ No ctx.from, skipping middleware');
    return next();
  }

  const userId = ctx.from.id;
  logger.info('👤 Processing user:', {
    id: userId,
    username: ctx.from.username,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name
  });

  const members = loadMembers();
  logger.info('📋 Current members:', members);
  
  const existingMember = members.find(m => m.id === userId);
  logger.info('🔍 Existing member check:', existingMember ? 'Found' : 'Not found');

  // Eğer kullanıcı yeni ise
  if (!existingMember) {
    logger.info('🎉 New user detected:', {
      id: userId,
      username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name
    });

    // Yeni kullanıcıyı ekle
    const newMember: Member = {
      id: userId,
      username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name
    };

    logger.info('➕ Adding new member:', newMember);
    members.push(newMember);
    
    logger.info('📋 Members before save:', members);
    saveMembers(members);
    logger.info('✅ New member added to members.json');

    // Adminlere bildirim gönder
    const userInfo = [
      `👤 Yeni Kullanıcı Bildirimi`,
      `ID: ${userId}`,
      ctx.from.first_name ? `İsim: ${ctx.from.first_name}` : '',
      ctx.from.last_name ? `Soyisim: ${ctx.from.last_name}` : '',
      ctx.from.username ? `Kullanıcı Adı: @${ctx.from.username}` : '',
      `Tarih: ${new Date().toLocaleString('tr-TR')}`
    ].filter(Boolean).join('\n');

    logger.info('📤 Sending notifications to admins');
    // Adminlere bildirim gönder
    for (const adminId of config.botAdmins) {
      try {
        logger.info(`📨 Sending notification to admin:`, adminId);
        await ctx.api.sendMessage(adminId, userInfo);
        logger.info(`✅ Notification sent successfully to admin:`, adminId);
      } catch (error) {
        logger.error(`❌ Error sending notification to admin ${adminId}:`, error);
      }
    }
  }

  return next();
});

export const newUserMiddleware = composer; 