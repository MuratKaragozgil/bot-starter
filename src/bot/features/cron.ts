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
  const changes = {
    newVehicles: [] as TeslaInventoryResponse['results'],
    priceChanges: [] as Array<{
      old: TeslaInventoryResponse['results'][0];
      new: TeslaInventoryResponse['results'][0];
    }>,
  };

  // Find new vehicles
  newVehicles.forEach(newVehicle => {
    const exists = oldVehicles.some(oldVehicle => 
      oldVehicle.TrimName === newVehicle.TrimName &&
      oldVehicle.PAINT[0] === newVehicle.PAINT[0] &&
      oldVehicle.INTERIOR[0] === newVehicle.INTERIOR[0] &&
      oldVehicle.WHEELS[0] === newVehicle.WHEELS[0]
    );
    if (!exists) {
      changes.newVehicles.push(newVehicle);
    }
  });

  // Find price changes
  oldVehicles.forEach(oldVehicle => {
    const newVehicle = newVehicles.find(v => 
      v.TrimName === oldVehicle.TrimName &&
      v.PAINT[0] === oldVehicle.PAINT[0] &&
      v.INTERIOR[0] === oldVehicle.INTERIOR[0] &&
      v.WHEELS[0] === oldVehicle.WHEELS[0]
    );
    if (newVehicle && newVehicle.InventoryPrice !== oldVehicle.InventoryPrice) {
      changes.priceChanges.push({ old: oldVehicle, new: newVehicle });
    }
  });

  return changes;
}

function formatVehicleMessage(vehicle: TeslaInventoryResponse['results'][0]) {
  const acceleration = vehicle.OptionCodeData.find(opt => opt.group === 'SPECS_ACCELERATION');
  const range = vehicle.OptionCodeData.find(opt => opt.group === 'SPECS_RANGE');
  
  return `${vehicle.TrimName}\n` +
    `💰 Fiyat: ${vehicle.InventoryPrice.toLocaleString('tr-TR')} TL\n` +
    `🎨 Renk: ${vehicle.PAINT[0]}\n` +
    `🛋️ İç Mekan: ${vehicle.INTERIOR[0]}\n` +
    `🛞 Jantlar: ${vehicle.WHEELS[0]}\n` +
    `⚡ 0-100: ${acceleration?.value || 'N/A'} ${acceleration?.unit_short || ''}\n` +
    `🔋 Menzil: ${range?.value || 'N/A'} ${range?.unit_short || ''}\n`;
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
      const response = await fetch(TESLA_API_URL, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as TeslaInventoryResponse;
      const storedInventory = loadStoredInventory();
      
      if (!storedInventory) {
        // First run, just save the inventory
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
          message += formatVehicleMessage(vehicle) + '\n';
        });
      }

      if (changes.priceChanges.length > 0) {
        message += `💰 Fiyat Değişiklikleri:\n\n`;
        changes.priceChanges.forEach(({ old, new: newVehicle }) => {
          message += `${newVehicle.TrimName}\n` +
            `Eski Fiyat: ${old.InventoryPrice.toLocaleString('tr-TR')} TL\n` +
            `Yeni Fiyat: ${newVehicle.InventoryPrice.toLocaleString('tr-TR')} TL\n` +
            `Fark: ${(newVehicle.InventoryPrice - old.InventoryPrice).toLocaleString('tr-TR')} TL\n\n`;
        });
      }

      message += `\nDetaylı bilgi için: https://www.tesla.com/tr_tr/inventory/new/my`;
      
      await bot.api.sendMessage(ADMIN_ID, message, {
        link_preview_options: {
          is_disabled: true
        }
      });

      // Save new inventory state
      saveInventory({
        timestamp: Date.now(),
        vehicles: data.results
      });

      logger.info('Cron job completed successfully');
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          logger.error('Tesla inventory check timed out');
          await bot.api.sendMessage(ADMIN_ID, '❌ Envanter kontrolü zaman aşımına uğradı.', {
            link_preview_options: {
              is_disabled: true
            }
          });
        } else {
          logger.error('Tesla inventory check failed:', error);
          await bot.api.sendMessage(ADMIN_ID, '❌ Envanter kontrolü sırasında bir hata oluştu.', {
            link_preview_options: {
              is_disabled: true
            }
          });
        }
      }
    } finally {
      clearTimeout(timeout);
      isJobRunning = false;
    }
  });

  logger.info('Cron job scheduled successfully');
} 