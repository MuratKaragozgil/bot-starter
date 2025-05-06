import type { Context } from '#root/bot/context.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  formatColor,
  formatInterior,
  formatWheels,
  isNewModelY,
} from '#root/bot/utils/tesla-utils.js'
import { logger } from '#root/logger.js'
import { Composer } from 'grammy'
import { HttpsProxyAgent } from 'https-proxy-agent'

const composer = new Composer<Context>()
const INVENTORY_FILE = path.join(process.cwd(), 'inventory.json')

const PROXY_URL = process.env.PROXY_URL || 'http://localhost:8080'
const TESLA_API_URL = 'https://www.tesla.com/tr_TR/inventory/api/v4/inventory-results?query=' + encodeURIComponent(JSON.stringify({
  query: {
    model: 'my',
    condition: 'new',
    options: {},
    arrangeby: 'Price',
    order: 'asc',
    market: 'TR',
    language: 'tr',
    super_region: 'europe',
    lng: 28.9784,
    lat: 41.0082,
    zip: '34384',
    range: 0,
    region: 'TR',
  },
  offset: 0,
  count: 24,
  outsideOffset: 0,
  outsideSearch: false,
  isFalconDeliverySelectionEnabled: true,
  version: 'v2',
}))

interface TeslaInventoryResponse {
  results: Array<{
    Model: string
    TrimName: string
    Price: number
    InventoryPrice: number
    PAINT: string[]
    INTERIOR: string[]
    WHEELS: string[]
    OptionCodeData: Array<{
      group: string
      value: string
      unit_short: string
    }>
  }>
  total_matches_found: string
}

interface StoredInventory {
  timestamp: number
  vehicles: TeslaInventoryResponse['results']
  total_matches_found: string
}

function formatVehicleMessage(vehicle: TeslaInventoryResponse['results'][0]) {
  try {
    const acceleration = vehicle.OptionCodeData?.find(
      opt => opt?.group === 'SPECS_ACCELERATION',
    )
    const range = vehicle.OptionCodeData?.find(
      opt => opt?.group === 'SPECS_RANGE',
    )
    const isNewModel = isNewModelY(vehicle)

    // Renk, iç mekan ve jant değerlerini formatla
    const color = vehicle.PAINT?.[0] ? formatColor(vehicle.PAINT[0]) : 'N/A'
    const interior = vehicle.INTERIOR?.[0]
      ? formatInterior(vehicle.INTERIOR[0])
      : 'N/A'
    const wheels = vehicle.WHEELS?.[0]
      ? formatWheels(vehicle.WHEELS[0])
      : 'N/A'

    return (
      `${vehicle.TrimName || 'Bilinmeyen Model'} ${isNewModel ? '🚀' : ''}\n`
      + `💰 Fiyat: ${vehicle.InventoryPrice?.toLocaleString('tr-TR') || 'N/A'} TL\n`
      + `🎨 Renk: ${color}\n`
      + `🛋️ İç Mekan: ${interior}\n`
      + `🛞 Jantlar: ${wheels}\n`
      + `⚡ 0-100: ${acceleration?.value || 'N/A'} ${acceleration?.unit_short || ''}\n`
      + `🔋 Menzil: ${range?.value || 'N/A'} ${range?.unit_short || ''}\n`
      + `📅 Model: ${isNewModel ? 'Yeni Model (Highland)' : 'Eski Model'}\n`
    )
  }
  catch (error) {
    logger.error('Error in formatVehicleMessage:', error)
    return (
      `❌ Hata: Araç bilgileri formatlanırken bir sorun oluştu\n`
      + `Model: ${vehicle.TrimName || 'Bilinmeyen Model'}\n`
      + `Fiyat: ${vehicle.InventoryPrice?.toLocaleString('tr-TR') || 'N/A'} TL\n`
    )
  }
}

composer.command('check', async (ctx) => {
  try {
    logger.info('Fetching Tesla inventory data from API...')
    const proxyAgent = new HttpsProxyAgent(PROXY_URL)
    logger.info(`Using proxy: ${PROXY_URL}`)

    // Test proxy connection
    try {
      const testResponse = await fetch('https://www.tesla.com', {
        // @ts-ignore - agent is a valid property for node-fetch
        agent: proxyAgent,
        timeout: 5000,
      })
      logger.info('Proxy connection test successful')
    }
    catch (proxyError) {
      logger.error('Proxy connection test failed:', proxyError)
      throw new Error(`Proxy connection failed: ${proxyError instanceof Error ? proxyError.message : 'Unknown error'}`)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000) // 30 seconds timeout

    const response = await fetch(TESLA_API_URL, {
      // @ts-ignore - agent is a valid property for node-fetch
      agent: proxyAgent,
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'referer': 'https://www.tesla.com/tr_TR/inventory/new/my',
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'x-requested-with': 'XMLHttpRequest'
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`HTTP error! status: ${response.status}, response: ${errorText}`)
      logger.error('Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2))
      throw new Error(`HTTP error! status: ${response.status}, response: ${errorText}`)
    }

    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text()
      logger.error('Invalid content type:', contentType)
      logger.error('Response body:', text)
      throw new Error(`Invalid content type: ${contentType}`)
    }

    const data = await response.json() as TeslaInventoryResponse
    logger.info('Tesla API Response:', JSON.stringify(data, null, 2))

    if (!data || !data.results) {
      logger.error('Invalid response format:', data)
      throw new Error('Invalid response format from Tesla API')
    }

    // Envanterde araç yoksa özel mesaj gönder
    if (data.results.length === 0) {
      await ctx.reply(
        '📢 Tesla Model Y Envanter Durumu\n\n'
        + '❌ Şu anda envanterde hiç araç bulunmuyor.\n'
        + 'Daha sonra tekrar kontrol etmek için /check komutunu kullanabilirsiniz.\n\n'
        + 'Detaylı bilgi için: https://www.tesla.com/tr_tr/inventory/new/my',
        {
          parse_mode: 'HTML',
          link_preview_options: {
            is_disabled: true,
          },
        },
      )
      return
    }

    let message
      = `🚗 Tesla Model Y Envanter Durumu:\n\n`
        + `Son Güncelleme: ${new Date().toLocaleTimeString('tr-TR')}\n`
        + `Toplam Araç Sayısı: ${data.total_matches_found || data.results.length}\n`
        + `Gösterilen Araç Sayısı: ${data.results.length}\n\n`
        + `📋 İlk 10 Araç Detayları:\n\n`

    // İlk 10 aracın detaylarını ekle
    data.results.slice(0, 10).forEach((vehicle, index) => {
      try {
        message += `${index + 1}. ${formatVehicleMessage(vehicle)}\n`
      }
      catch (vehicleError) {
        logger.error(`Error processing vehicle ${index + 1}:`, vehicleError)
        message += `${index + 1}. Hata: Araç bilgileri işlenirken bir sorun oluştu\n\n`
      }
    })

    message += `\nDetaylı bilgi için: https://www.tesla.com/tr_tr/inventory/new/my`

    await ctx.reply(message, {
      parse_mode: 'HTML',
      link_preview_options: {
        is_disabled: true,
      },
    })
  }
  catch (error) {
    logger.error('Error fetching Tesla inventory:', error)
    if (error instanceof Error) {
      logger.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
      })
    }
    await ctx.reply(
      '❌ <b>Hata Oluştu</b>\n\n'
      + 'Tesla envanteri alınırken bir sorun oluştu.\n'
      + 'Lütfen birkaç dakika sonra tekrar deneyin.',
      {
        parse_mode: 'HTML',
        link_preview_options: {
          is_disabled: true,
        },
      },
    )
  }
})

export const teslaFeature = composer
