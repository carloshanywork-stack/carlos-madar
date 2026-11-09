import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, toProblemDetails } from '../src/errors.js';

test('AppError maps to RFC 9457 problem details', () => {
  const error = AppError.conflict('email_taken', 'Email already registered');
  const problem = toProblemDetails(error, { instance: '/api/v1/auth/register', traceId: 'trace-1' });
  assert.equal(problem.status, 409);
  assert.equal(problem.code, 'email_taken');
  assert.equal(problem.title, 'Email already registered');
  assert.equal(problem.instance, '/api/v1/auth/register');
  assert.equal(problem.traceId, 'trace-1');
  assert.match(problem.type, /email_taken$/);
});

test('AppError keeps the message override', () => {
  const error = AppError.badRequest('validation_error', 'Invalid input', 'email must be valid');
  assert.equal(error.message, 'email must be valid');
  assert.equal(error.title, 'Invalid input');
});
