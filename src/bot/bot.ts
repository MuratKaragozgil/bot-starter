import { Bot } from 'grammy';
import { config } from '#root/config.js';
import type { Context } from '#root/bot/context.js';
import { teslaFeature } from '#root/bot/features/tesla.js';
import { welcomeFeature } from '#root/bot/features/welcome.js';
import { newUserMiddleware } from '#root/bot/middleware/new-user.js';

export const bot = new Bot<Context>(config.botToken);

// Global middleware
bot.use(newUserMiddleware);

// Features
bot.use(welcomeFeature);
bot.use(teslaFeature); 