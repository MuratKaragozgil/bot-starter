import cron from 'node-cron';
import { Bot } from 'grammy';
import type { Context } from '#root/bot/context.js';
import { logger } from '#root/logger.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { sendRateLimitedMessage } from '#root/bot/utils/rate-limited-sender.js';
import { isNewModelY, formatColor, formatInterior, formatWheels, PROXY_URL } from '#root/bot/utils/tesla-utils.js';
import { HttpsProxyAgent } from 'https-proxy-agent';

interface TeslaInventoryResponse {
  results: Array<{
    Model: string;
    TrimName: string;
    Price: number;
    InventoryPrice: number;
    PAINT: string[];
    INTERIOR: string[];
    WHEELS: string[];
    OptionCodeData: Array<{
      group: string;
      value: string;
      unit_short: string;
    }>;
    VIN?: string;
  }>;
  total_matches_found: string;
}

interface StoredInventory {
  timestamp: number;
  vehicles: TeslaInventoryResponse['results'];
  total_matches_found: string;
}

const TESLA_API_URL = 'https://www.tesla.com/inventory/api/v4/inventory-results?query=%7B%22query%22%3A%7B%22model%22%3A%22my%22%2C%22condition%22%3A%22new%22%2C%22options%22%3A%7B%7D%2C%22arrangeby%22%3A%22Price%22%2C%22order%22%3A%22asc%22%2C%22market%22%3A%22TR%22%2C%22language%22%3A%22tr%22%2C%22super_region%22%3A%22north%20america%22%2C%22lng%22%3A28.9601%2C%22lat%22%3A41.03%2C%22zip%22%3A%2234080%22%2C%22range%22%3A0%2C%22region%22%3A%22TR%22%7D%2C%22offset%22%3A0%2C%22count%22%3A24%2C%22outsideOffset%22%3A0%2C%22outsideSearch%22%3Afalse%2C%22isFalconDeliverySelectionEnabled%22%3Atrue%2C%22version%22%3A%22v2%22%7D';

const ADMIN_ID = 740651254; // Your Telegram ID
const INVENTORY_FILE = path.join(process.cwd(), 'inventory.json');

let isJobRunning = false;
let lastRunTime = 0;
let cronJob: cron.ScheduledTask | null = null;

function cleanup() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
  isJobRunning = false;
}

// SIGINT (Ctrl+C) ve SIGTERM sinyallerini yakala
process.on('SIGINT', () => {
  logger.info('Received SIGINT signal, cleaning up...');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal, cleaning up...');
  cleanup();
  process.exit(0);
});

function loadStoredInventory(): StoredInventory | null {
  try {
    if (fs.existsSync(INVENTORY_FILE)) {
      const data = fs.readFileSync(INVENTORY_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('Error loading stored inventory:', error);
  }
  return null;
}

function saveInventory(inventory: StoredInventory) {
  try {
    fs.writeFileSync(INVENTORY_FILE, JSON.stringify(inventory, null, 2));
    logger.info('Inventory data saved successfully');
  } catch (error) {
    logger.error('Error saving inventory data:', error);
  }
}

function findChanges(oldVehicles: TeslaInventoryResponse['results'], newVehicles: TeslaInventoryResponse['results']) {
  try {
    logger.info(`Comparing vehicles - Old: ${oldVehicles.length}, New: ${newVehicles.length}`);
    
    const changes = {
      newVehicles: [] as TeslaInventoryResponse['results']
    };

    // Create a set of existing VINs for faster lookup
    const existingVINs = new Set();
    oldVehicles.forEach(vehicle => {
      if (vehicle.VIN) {
        existingVINs.add(vehicle.VIN);
        logger.info(`Old vehicle VIN: ${vehicle.VIN}`);
      }
    });

    // Check each new vehicle
    newVehicles.forEach(vehicle => {
      if (vehicle.VIN) {
        logger.info(`Checking new vehicle VIN: ${vehicle.VIN}`);
        
        if (!existingVINs.has(vehicle.VIN)) {
          logger.info(`New vehicle found with VIN: ${vehicle.VIN}`);
          logger.info(`New vehicle details: ${vehicle.TrimName} - ${vehicle.PAINT?.[0]} - ${vehicle.INTERIOR?.[0]} - ${vehicle.WHEELS?.[0]}`);
          changes.newVehicles.push(vehicle);
        }
      } else {
        logger.warn(`Vehicle found without VIN: ${vehicle.TrimName}`);
      }
    });

    logger.info(`Changes found: ${changes.newVehicles.length} new vehicles`);
    return changes;
  } catch (error) {
    logger.error('Error in findChanges:', error);
    return {
      newVehicles: []
    };
  }
}

function formatVehicleMessage(vehicle: TeslaInventoryResponse['results'][0]) {
  try {
    const acceleration = vehicle.OptionCodeData?.find(opt => opt?.group === 'SPECS_ACCELERATION');
    const range = vehicle.OptionCodeData?.find(opt => opt?.group === 'SPECS_RANGE');
    const isNewModel = isNewModelY(vehicle);
    
    return `${vehicle.TrimName || 'Bilinmeyen Model'} ${isNewModel ? '🚀' : ''}\n` +
      `💰 Fiyat: ${vehicle.InventoryPrice?.toLocaleString('tr-TR') || 'N/A'} TL\n` +
      `🎨 Renk: ${vehicle.PAINT?.[0] || 'N/A'}\n` +
      `🛋️ İç Mekan: ${vehicle.INTERIOR?.[0] || 'N/A'}\n` +
      `🛞 Jantlar: ${vehicle.WHEELS?.[0] || 'N/A'}\n` +
      `⚡ 0-100: ${acceleration?.value || 'N/A'} ${acceleration?.unit_short || ''}\n` +
      `🔋 Menzil: ${range?.value || 'N/A'} ${range?.unit_short || ''}\n` +
      `📅 Model: ${isNewModel ? 'Yeni Model (Highland)' : 'Eski Model'}\n`;
  } catch (error) {
    logger.error('Error in formatVehicleMessage:', error);
    return `❌ Hata: Araç bilgileri formatlanırken bir sorun oluştu\n` +
      `Model: ${vehicle.TrimName || 'Bilinmeyen Model'}\n` +
      `Fiyat: ${vehicle.InventoryPrice?.toLocaleString('tr-TR') || 'N/A'} TL\n`;
  }
}

export function setupCronJob(bot: Bot<Context>) {
  // Run every 30 seconds
  cronJob = cron.schedule('*/30 * * * * *', async () => {
    const now = Date.now();
    
    if (isJobRunning || (now - lastRunTime) < 30000) {
      logger.info('Previous job is still running or not enough time has passed, skipping this iteration');
      return;
    }

    isJobRunning = true;
    lastRunTime = now;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      logger.info('Starting Tesla inventory check...');
      const proxyAgent = new HttpsProxyAgent(PROXY_URL);
      
      const response = await fetch(TESLA_API_URL, {
        signal: controller.signal,
        agent: proxyAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`HTTP error! status: ${response.status}, response: ${errorText}`);
        throw new Error(`HTTP error! status: ${response.status}, response: ${errorText}`);
      }

      logger.info('Parsing Tesla inventory data...');
      const data = await response.json() as TeslaInventoryResponse;
      
      if (!data || !data.results) {
        logger.error('Invalid response format:', data);
        throw new Error('Invalid response format from Tesla API');
      }

      const storedInventory = loadStoredInventory();
      
      // Her durumda yeni veriyi kaydet
      const newInventory: StoredInventory = {
        timestamp: Date.now(),
        vehicles: data.results,
        total_matches_found: data.total_matches_found
      };

      // Mevcut envanter durumunu logla
      if (storedInventory) {
        logger.info('Current stored inventory:', {
          timestamp: new Date(storedInventory.timestamp).toISOString(),
          vehicleCount: storedInventory.vehicles.length,
          total_matches_found: storedInventory.total_matches_found
        });
      }

      // Yeni envanter durumunu logla
      logger.info('New inventory data:', {
        timestamp: new Date(newInventory.timestamp).toISOString(),
        vehicleCount: newInventory.vehicles.length,
        total_matches_found: newInventory.total_matches_found
      });
      
      saveInventory(newInventory);
      logger.info('New inventory data saved');
      
      if (!storedInventory) {
        // First run, just save the inventory
        logger.info('First run detected, saving initial inventory');
        await bot.api.sendMessage(ADMIN_ID, '📊 İlk envanter kontrolü tamamlandı. Değişiklikler bundan sonra takip edilecek.');
        return;
      }

      const changes = findChanges(storedInventory.vehicles, data.results);
      
      if (changes.newVehicles.length === 0) {
        logger.info('No changes found in inventory');
        return;
      }

      logger.info(`Found ${changes.newVehicles.length} new vehicles, preparing notification...`);

      let message = `🔄 Tesla Model Y Envanter Güncellemesi (${new Date().toLocaleTimeString('tr-TR')}):\n\n`;

      if (changes.newVehicles.length > 0) {
        message += `🚗 Yeni Araçlar:\n\n`;
        changes.newVehicles.forEach(vehicle => {
          try {
            message += formatVehicleMessage(vehicle) + '\n';
          } catch (error) {
            logger.error('Error formatting vehicle message:', error);
            message += `❌ Hata: Araç bilgileri formatlanırken bir sorun oluştu\n\n`;
          }
        });
      }

      // Sadece admin'e değil, tüm üyelere bildirim gönder
      await sendRateLimitedMessage(bot, message, {
        parse_mode: 'HTML',
        link_preview_options: {
          is_disabled: true,
        }
      });

    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          logger.error('Tesla inventory check timed out');
          await bot.api.sendMessage(ADMIN_ID,
            '⚠️ <b>Zaman Aşımı Hatası</b>\n\n' +
            'Envanter kontrolü 10 saniye içinde tamamlanamadı.\n' +
            'Lütfen birkaç dakika sonra tekrar deneyin.',
            {
              parse_mode: 'HTML',
              link_preview_options: {
                is_disabled: true
              }
            }
          );
        } else {
          logger.error('Tesla inventory check failed:', error);
          await bot.api.sendMessage(ADMIN_ID,
            '❌ <b>Hata Oluştu</b>\n\n' +
            'Envanter kontrolü sırasında bir sorun oluştu.\n' +
            'Lütfen birkaç dakika sonra tekrar deneyin.\n\n' +
            '<i>Hata Detayı:</i>\n' +
            `<code>${error.message}</code>`,
            {
              parse_mode: 'HTML',
              link_preview_options: {
                is_disabled: true
              }
            }
          );
        }
      } else {
        logger.error('Unknown error occurred:', error);
        await bot.api.sendMessage(ADMIN_ID,
          '❌ <b>Bilinmeyen Hata</b>\n\n' +
          'Beklenmeyen bir hata oluştu.\n' +
          'Lütfen birkaç dakika sonra tekrar deneyin.',
          {
            parse_mode: 'HTML',
            link_preview_options: {
              is_disabled: true
            }
          }
        );
      }
    } finally {
      clearTimeout(timeout);
      isJobRunning = false;
    }
  });

  logger.info('Cron job scheduled successfully');
} 