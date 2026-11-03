const assert = require('node:assert/strict')
const test = require('node:test')
const { calculateIssue } = require('../src/inventory')

test('rounds fractional consumption up in the main warehouse and records the reusable remainder', () => {
  assert.deepEqual(calculateIssue({ mainStock: 5, subStock: 0, quantity: 1.75 }), {
    stock: 3,
    subStock: 0.25,
    mainDeducted: 2,
    subUsed: 0,
    offcutCreated: 0.25,
  })
})

test('uses existing offcuts first and stores any new remainder', () => {
  assert.deepEqual(calculateIssue({ mainStock: 3, subStock: 0.25, quantity: 0.75 }), {
    stock: 2,
    subStock: 0.5,
    mainDeducted: 1,
    subUsed: 0.25,
    offcutCreated: 0.5,
  })
})

test('can issue from the sub-warehouse without withdrawing a full unit', () => {
  assert.deepEqual(calculateIssue({ mainStock: 0, subStock: 0.25, quantity: 0.2 }), {
    stock: 0,
    subStock: 0.05,
    mainDeducted: 0,
    subUsed: 0.2,
    offcutCreated: 0,
  })
})

test('allows explicit source selection and records main-warehouse rounding as an offcut', () => {
  assert.deepEqual(calculateIssue({ mainStock: 3, subStock: 0.5, quantity: 1.25, warehouse: 'main' }), {
    stock: 1, subStock: 1.25, mainDeducted: 2, subUsed: 0, offcutCreated: 0.75,
  })
  assert.throws(() => calculateIssue({ mainStock: 3, subStock: 0.5, quantity: 1.25, warehouse: 'sub' }), /لا يكفي/)
})

test('rejects insufficient combined stock and fractional main stock', () => {
  assert.throws(() => calculateIssue({ mainStock: 1, subStock: 0.1, quantity: 1.2 }), /لا يكفي/)
  assert.throws(() => calculateIssue({ mainStock: 1.5, subStock: 0, quantity: 1 }), /غير صالحة/)
})
