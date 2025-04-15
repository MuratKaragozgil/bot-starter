import cron from 'node-cron';
import { Bot } from 'grammy';
import type { Context } from '#root/bot/context.js';
import { logger } from '#root/logger.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

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
  }>;
  total_matches_found: string;
}

interface StoredInventory {
  timestamp: number;
  vehicles: TeslaInventoryResponse['results'];
}

const TESLA_API_URL = 'https://www.tesla.com/inventory/api/v4/inventory-results?query=%7B%22query%22%3A%7B%22model%22%3A%22my%22%2C%22condition%22%3A%22new%22%2C%22options%22%3A%7B%7D%2C%22arrangeby%22%3A%22Price%22%2C%22order%22%3A%22asc%22%2C%22market%22%3A%22TR%22%2C%22language%22%3A%22tr%22%2C%22super_region%22%3A%22north%20america%22%2C%22lng%22%3A28.9601%2C%22lat%22%3A41.03%2C%22zip%22%3A%2234080%22%2C%22range%22%3A0%2C%22region%22%3A%22TR%22%7D%2C%22offset%22%3A0%2C%22count%22%3A24%2C%22outsideOffset%22%3A0%2C%22outsideSearch%22%3Afalse%2C%22isFalconDeliverySelectionEnabled%22%3Atrue%2C%22version%22%3A%22v2%22%7D';

const ADMIN_ID = 740651254; // Your Telegram ID
const INVENTORY_FILE = path.join(process.cwd(), 'inventory.json');

let isJobRunning = false;
let lastRunTime = 0;

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
  } catch (error) {
    logger.error('Error saving inventory:', error);
  }
}

function findChanges(oldVehicles: TeslaInventoryResponse['results'], newVehicles: TeslaInventoryResponse['results']) {
  try {
    const changes = {
      newVehicles: [] as TeslaInventoryResponse['results'],
      priceChanges: [] as Array<{
        old: TeslaInventoryResponse['results'][0];
        new: TeslaInventoryResponse['results'][0];
      }>,
    };

    // Find new vehicles
    newVehicles.forEach(newVehicle => {
      try {
        const exists = oldVehicles.some(oldVehicle => 
          oldVehicle?.TrimName === newVehicle?.TrimName &&
          oldVehicle?.PAINT?.[0] === newVehicle?.PAINT?.[0] &&
          oldVehicle?.INTERIOR?.[0] === newVehicle?.INTERIOR?.[0] &&
          oldVehicle?.WHEELS?.[0] === newVehicle?.WHEELS?.[0]
        );
        if (!exists) {
          changes.newVehicles.push(newVehicle);
        }
      } catch (error) {
        logger.error('Error comparing vehicles:', error);
      }
    });

    // Find price changes
    oldVehicles.forEach(oldVehicle => {
      try {
        const newVehicle = newVehicles.find(v => 
          v?.TrimName === oldVehicle?.TrimName &&
          v?.PAINT?.[0] === oldVehicle?.PAINT?.[0] &&
          v?.INTERIOR?.[0] === oldVehicle?.INTERIOR?.[0] &&
          v?.WHEELS?.[0] === oldVehicle?.WHEELS?.[0]
        );
        if (newVehicle && newVehicle.InventoryPrice !== oldVehicle.InventoryPrice) {
          changes.priceChanges.push({ old: oldVehicle, new: newVehicle });
        }
      } catch (error) {
        logger.error('Error comparing prices:', error);
      }
    });

    return changes;
  } catch (error) {
    logger.error('Error in findChanges:', error);
    return {
      newVehicles: [],
      priceChanges: []
    };
  }
}

function isNewModelY(vehicle: TeslaInventoryResponse['results'][0]): boolean {
  try {
    // Yeni model Y'lerin özellikleri:
    // 1. Ambient lighting özelliği var
    // 2. Rear screen özelliği var
    // 3. Yeni jant tasarımları (19" Photon veya 20" Induction)
    // 4. Yeni renk seçenekleri (Stealth Grey, Ultra Red)
    
    if (!vehicle?.OptionCodeData || !vehicle?.WHEELS || !vehicle?.PAINT) {
      return false;
    }
    
    const hasAmbientLighting = vehicle.OptionCodeData.some(opt => 
      opt?.group === 'INTERIOR' && opt?.value?.includes('Ambient')
    );
    
    const hasRearScreen = vehicle.OptionCodeData.some(opt => 
      opt?.group === 'INTERIOR' && opt?.value?.includes('Rear Screen')
    );
    
    const hasNewWheels = vehicle.WHEELS.some(wheel => 
      wheel?.includes('Photon') || wheel?.includes('Induction')
    );
    
    const hasNewColors = vehicle.PAINT.some(color => 
      color?.includes('Stealth Grey') || color?.includes('Ultra Red')
    );
    
    // Eğer bu özelliklerden herhangi biri varsa, yeni modeldir
    return hasAmbientLighting || hasRearScreen || hasNewWheels || hasNewColors;
  } catch (error) {
    logger.error('Error in isNewModelY:', error);
    return false;
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
  cron.schedule('*/30 * * * * *', async () => {
    const now = Date.now();
    
    // Prevent multiple instances from running simultaneously
    // and ensure at least 30 seconds have passed since last run
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
      const response = await fetch(TESLA_API_URL, {
        signal: controller.signal,
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
      
      if (!storedInventory) {
        // First run, just save the inventory
        logger.info('First run detected, saving initial inventory');
        saveInventory({
          timestamp: Date.now(),
          vehicles: data.results
        });
        await bot.api.sendMessage(ADMIN_ID, '📊 İlk envanter kontrolü tamamlandı. Değişiklikler bundan sonra takip edilecek.');
        return;
      }

      const changes = findChanges(storedInventory.vehicles, data.results);
      
      if (changes.newVehicles.length === 0 && changes.priceChanges.length === 0) {
        logger.info('No changes found in inventory');
        return;
      }

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

      if (changes.priceChanges.length > 0) {
        message += `💰 Fiyat Değişiklikleri:\n\n`;
        changes.priceChanges.forEach(({ old, new: newVehicle }) => {
          try {
            message += `${old.TrimName}\n` +
              `Eski Fiyat: ${old.InventoryPrice.toLocaleString('tr-TR')} TL\n` +
              `Yeni Fiyat: ${newVehicle.InventoryPrice.toLocaleString('tr-TR')} TL\n` +
              `Fark: ${(newVehicle.InventoryPrice - old.InventoryPrice).toLocaleString('tr-TR')} TL\n\n`;
          } catch (error) {
            logger.error('Error formatting price change message:', error);
            message += `❌ Hata: Fiyat değişikliği formatlanırken bir sorun oluştu\n\n`;
          }
        });
      }

      // Save the new inventory
      saveInventory({
        timestamp: Date.now(),
        vehicles: data.results
      });

      await bot.api.sendMessage(ADMIN_ID, message, {
        parse_mode: 'HTML',
        link_preview_options: {
          is_disabled: true
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