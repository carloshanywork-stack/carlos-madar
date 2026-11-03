const assert = require('node:assert/strict')
const test = require('node:test')
const { currencyAmountFromCents, parseCurrencyAmount, parseCurrencyCents } = require('../src/money')

test('accepts nonnegative currency with at most two decimal places', () => {
  assert.equal(parseCurrencyCents('0', { allowZero: true }), 0)
  assert.equal(parseCurrencyAmount('12.3'), 12.3)
  assert.equal(parseCurrencyCents(12.34), 1234)
  assert.equal(parseCurrencyAmount('12.34'), 12.34)
  assert.equal(currencyAmountFromCents(1234), 12.34)
})

test('rejects excess precision, negatives, malformed values, and unsafe amounts', () => {
  for (const value of ['1.001', 1.001, '-1.00', '1e3', '1,25', '']) {
    assert.equal(parseCurrencyCents(value, { allowZero: true }), null, String(value))
  }
  assert.equal(parseCurrencyCents('0'), null)
  assert.equal(parseCurrencyCents('90071992547409.92', { allowZero: true }), null)
})
