import { logger } from '#root/logger.js'

// Proxy configuration
export const PROXY_CONFIG = {
  host: 'gate.smartproxy.com',
  port: '10001',
  auth: 'spezv1a5gj:h1_TLlfOF7r3u9whkx',
}

// Proxy URL for fetch
export const PROXY_URL = `http://${PROXY_CONFIG.auth}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`

interface TeslaVehicle {
  OptionCodeData?: Array<{
    group: string
    value: string
    unit_short: string
  }>
}

export function isNewModelY(vehicle: TeslaVehicle): boolean {
  try {
    if (!vehicle?.OptionCodeData) {
      return false
    }

    // Range değerini kontrol et
    const range = vehicle.OptionCodeData.find(
      opt => opt?.group === 'SPECS_RANGE',
    )
    if (range && Number.parseInt(range.value) >= 568) {
      return true
    }

    return false
  }
  catch (error) {
    logger.error('Error in isNewModelY:', error)
    return false
  }
}

export function formatColor(color: string): string {
  switch (color) {
    case 'PREMIUM_BLACK':
      return 'Siyah'
    case 'PREMIUM_WHITE':
      return 'Beyaz'
    case 'STEALTH_GREY':
      return 'Stealth Gri'
    case 'ULTRA_RED':
      return 'Ultra Kırmızı'
    case 'DEEP_BLUE':
      return 'Koyu Mavi'
    case 'MIDNIGHT_SILVER':
      return 'Gece Gümüşü'
    case 'SILVER':
      return 'Gümüş'
    case 'GREY':
      return 'Gri'
    default:
      return color
  }
}

export function formatInterior(interior: string): string {
  switch (interior) {
    case 'PREMIUM_BLACK':
      return 'Siyah Premium'
    case 'PREMIUM_WHITE':
      return 'Beyaz Premium'
    case 'BLACK':
      return 'Siyah'
    case 'WHITE':
      return 'Beyaz'
    case 'CREAM':
      return 'Krem'
    default:
      return interior
  }
}

export function formatWheels(wheels: string): string {
  switch (wheels) {
    case 'NINETEEN':
      return '19" Crossflow'
    case 'TWENTY_ONE':
      return '21" Überturbine'
    case 'PHOTON':
      return '19" Photon'
    case 'INDUCTION':
      return '20" Induction'
    default:
      return wheels
  }
}
