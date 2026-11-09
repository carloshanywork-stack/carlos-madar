import assert from 'node:assert/strict';
import test from 'node:test';
import {
  interpolateString,
  resolveTemplates,
  validateExpressionsIn,
  validateExpression,
} from '../src/expressions.js';

const context = {
  json: { name: 'أحمد', count: 2, meta: { city: 'القاهرة' } },
  node: { 'طلب HTTP': { status: 200 } },
};

test('whole expression keeps the native JSONata type', async () => {
  assert.equal(await interpolateString('{{ $json.count + 1 }}', context), 3);
  assert.deepEqual(await interpolateString('{{ $json.meta }}', context), { city: 'القاهرة' });
});

test('mixed strings are interpolated', async () => {
  assert.equal(
    await interpolateString('مرحبًا {{ $json.name }} — العدد {{ $json.count }}', context),
    'مرحبًا أحمد — العدد 2',
  );
});

test('templates resolve deeply through objects and arrays', async () => {
  const resolved = await resolveTemplates(
    {
      message: '{{ $json.name }}',
      nested: ['{{ $json.count * 2 }}', { city: '{{ $json.meta.city }}' }],
      plain: 'no expressions',
    },
    context,
  );
  assert.deepEqual(resolved, {
    message: 'أحمد',
    nested: [4, { city: 'القاهرة' }],
    plain: 'no expressions',
  });
});

test('invalid syntax is reported with a path', () => {
  assert.ok(validateExpression('$json.'));
  const issues = validateExpressionsIn({ url: 'https://x/{{ $json. }}' }, 'parameters');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.path, 'parameters.url');
});

test('unclosed braces are reported', () => {
  const issues = validateExpressionsIn({ value: '{{ $json.name' });
  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /غير مغلقة/);
});

test('plain strings pass without evaluation', () => {
  assert.equal(validateExpression('  '), 'التعبير فارغ.');
  assert.deepEqual(validateExpressionsIn({ value: 'plain' }), []);
});
