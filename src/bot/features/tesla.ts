import { Composer } from 'grammy';
import type { Context } from '#root/bot/context.js';
import { logger } from '#root/logger.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { isNewModelY, formatColor, formatInterior, formatWheels, PROXY_URL } from '#root/bot/utils/tesla-utils.js';
import { HttpsProxyAgent } from 'https-proxy-agent';

const composer = new Composer<Context>();
const INVENTORY_FILE = path.join(process.cwd(), 'inventory.json');

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
  total_matches_found: string;
}

function formatVehicleMessage(vehicle: TeslaInventoryResponse['results'][0]) {
  try {
    const acceleration = vehicle.OptionCodeData?.find(opt => opt?.group === 'SPECS_ACCELERATION');
    const range = vehicle.OptionCodeData?.find(opt => opt?.group === 'SPECS_RANGE');
    const isNewModel = isNewModelY(vehicle);
    
    // Renk, iç mekan ve jant değerlerini formatla
    const color = vehicle.PAINT?.[0] ? formatColor(vehicle.PAINT[0]) : 'N/A';
    const interior = vehicle.INTERIOR?.[0] ? formatInterior(vehicle.INTERIOR[0]) : 'N/A';
    const wheels = vehicle.WHEELS?.[0] ? formatWheels(vehicle.WHEELS[0]) : 'N/A';
    
    return `${vehicle.TrimName || 'Bilinmeyen Model'} ${isNewModel ? '🚀' : ''}\n` +
      `💰 Fiyat: ${vehicle.InventoryPrice?.toLocaleString('tr-TR') || 'N/A'} TL\n` +
      `🎨 Renk: ${color}\n` +
      `🛋️ İç Mekan: ${interior}\n` +
      `🛞 Jantlar: ${wheels}\n` +
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

composer.command('check', async (ctx) => {
  try {
    logger.info('Reading inventory data from file...');
    
    if (!fs.existsSync(INVENTORY_FILE)) {
      await ctx.reply(
        '❌ Henüz envanter verisi bulunamadı.\n' +
        'Lütfen birkaç dakika bekleyip tekrar deneyin.',
        {
          parse_mode: 'HTML',
          link_preview_options: {
            is_disabled: true
          }
        }
      );
      return;
    }

    const inventoryData = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf-8')) as StoredInventory;
    const lastUpdateTime = new Date(inventoryData.timestamp).toLocaleTimeString('tr-TR');
    
    if (!inventoryData.vehicles || !Array.isArray(inventoryData.vehicles)) {
      logger.error('Invalid inventory data format:', inventoryData);
      throw new Error('Invalid inventory data format');
    }

    // Envanterde araç yoksa özel mesaj gönder
    if (inventoryData.vehicles.length === 0) {
      await ctx.reply(
        '📢 Tesla Model Y Envanter Durumu\n\n' +
        '❌ Şu anda envanterde hiç araç bulunmuyor.\n' +
        'Daha sonra tekrar kontrol etmek için /check komutunu kullanabilirsiniz.\n\n' +
        'Detaylı bilgi için: https://www.tesla.com/tr_tr/inventory/new/my',
        {
          parse_mode: 'HTML',
          link_preview_options: {
            is_disabled: true
          }
        }
      );
      return;
    }
    
    let message = `🚗 Tesla Model Y Envanter Durumu:\n\n` +
      `Son Güncelleme: ${lastUpdateTime}\n` +
      `Toplam Araç Sayısı: ${inventoryData.total_matches_found || inventoryData.vehicles.length}\n` +
      `Gösterilen Araç Sayısı: ${inventoryData.vehicles.length}\n\n` +
      `📋 İlk 10 Araç Detayları:\n\n`;

    // İlk 10 aracın detaylarını ekle
    inventoryData.vehicles.slice(0, 10).forEach((vehicle, index) => {
      try {
        message += `${index + 1}. ${formatVehicleMessage(vehicle)}\n`;
      } catch (vehicleError) {
        logger.error(`Error processing vehicle ${index + 1}:`, vehicleError);
        message += `${index + 1}. Hata: Araç bilgileri işlenirken bir sorun oluştu\n\n`;
      }
    });

    message += `\nDetaylı bilgi için: https://www.tesla.com/tr_tr/inventory/new/my`;
    
    await ctx.reply(message, {
      parse_mode: 'HTML',
      link_preview_options: {
        is_disabled: true
      }
    });
  } catch (error) {
    logger.error('Error reading inventory data:', error);
    await ctx.reply(
      '❌ <b>Hata Oluştu</b>\n\n' +
      'Envanter verisi okunurken bir sorun oluştu.\n' +
      'Lütfen birkaç dakika sonra tekrar deneyin.',
      {
        parse_mode: 'HTML',
        link_preview_options: {
          is_disabled: true
        }
      }
    );
  }
});

export const teslaFeature = composer; 