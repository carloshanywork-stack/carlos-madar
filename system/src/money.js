const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER)

function parseCurrencyCents(value, { allowZero = false } = {}) {
  const text = typeof value === 'number'
    ? (Number.isFinite(value) ? String(value) : '')
    : typeof value === 'string' ? value.trim() : ''
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null

  const [whole, fraction = ''] = text.split('.')
  const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))
  if (cents > MAX_SAFE_CENTS || (!allowZero && cents === 0n)) return null
  return Number(cents)
}

function currencyAmountFromCents(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return null
  const amount = cents / 100
  return Math.round(amount * 100) === cents ? amount : null
}

function parseCurrencyAmount(value, options) {
  const cents = parseCurrencyCents(value, options)
  return cents === null ? null : currencyAmountFromCents(cents)
}

module.exports = { MAX_SAFE_CENTS, currencyAmountFromCents, parseCurrencyAmount, parseCurrencyCents }
