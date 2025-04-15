import { Composer } from 'grammy';
import type { Context } from '#root/bot/context.js';
import { logger } from '#root/logger.js';
import fetch from 'node-fetch';

const composer = new Composer<Context>();

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

const TESLA_API_URL = 'https://www.tesla.com/inventory/api/v4/inventory-results?query=%7B%22query%22%3A%7B%22model%22%3A%22my%22%2C%22condition%22%3A%22new%22%2C%22options%22%3A%7B%7D%2C%22arrangeby%22%3A%22Price%22%2C%22order%22%3A%22asc%22%2C%22market%22%3A%22TR%22%2C%22language%22%3A%22tr%22%2C%22super_region%22%3A%22north%20america%22%2C%22lng%22%3A28.9601%2C%22lat%22%3A41.03%2C%22zip%22%3A%2234080%22%2C%22range%22%3A0%2C%22region%22%3A%22TR%22%7D%2C%22offset%22%3A0%2C%22count%22%3A24%2C%22outsideOffset%22%3A0%2C%22outsideSearch%22%3Afalse%2C%22isFalconDeliverySelectionEnabled%22%3Atrue%2C%22version%22%3A%22v2%22%7D';

function isNewModelY(vehicle: TeslaInventoryResponse['results'][0]): boolean {
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
}

composer.command('check', async (ctx) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10 saniye timeout

  try {
    logger.info('Fetching Tesla inventory data...');
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
    
    const totalVehicles = data.total_matches_found;
    const availableVehicles = data.results.length;
    
    let message = `🚗 Tesla Model Y Envanter Durumu:\n\n` +
      `Toplam Araç Sayısı: ${totalVehicles}\n` +
      `Gösterilen Araç Sayısı: ${availableVehicles}\n\n` +
      `📋 İlk 10 Araç Detayları:\n\n`;

    // İlk 10 aracın detaylarını ekle
    data.results.slice(0, 10).forEach((vehicle, index) => {
      try {
        const acceleration = vehicle.OptionCodeData?.find(opt => opt.group === 'SPECS_ACCELERATION');
        const range = vehicle.OptionCodeData?.find(opt => opt.group === 'SPECS_RANGE');
        const isNewModel = isNewModelY(vehicle);
        
        message += `${index + 1}. ${vehicle.TrimName} ${isNewModel ? '🚀' : ''}\n` +
          `💰 Fiyat: ${vehicle.InventoryPrice.toLocaleString('tr-TR')} TL\n` +
          `🎨 Renk: ${vehicle.PAINT?.[0] || 'N/A'}\n` +
          `🛋️ İç Mekan: ${vehicle.INTERIOR?.[0] || 'N/A'}\n` +
          `🛞 Jantlar: ${vehicle.WHEELS?.[0] || 'N/A'}\n` +
          `⚡ 0-100: ${acceleration?.value || 'N/A'} ${acceleration?.unit_short || ''}\n` +
          `🔋 Menzil: ${range?.value || 'N/A'} ${range?.unit_short || ''}\n` +
          `📅 Model: ${isNewModel ? 'Yeni Model (Highland)' : 'Eski Model'}\n\n`;
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
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        logger.error('Tesla inventory check timed out');
        await ctx.reply(
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
        await ctx.reply(
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
      await ctx.reply(
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
  }
});

export const teslaFeature = composer; 