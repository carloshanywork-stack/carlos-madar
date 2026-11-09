import jsonata from 'jsonata';

const MAX_EXPRESSION_LENGTH = 2_000;
const INTERPOLATION = /\{\{([\s\S]*?)\}\}/g;
const WHOLE_EXPRESSION = /^\s*\{\{([\s\S]+)\}\}\s*$/;

export interface ExpressionIssue {
  path: string;
  expression: string;
  message: string;
}

export class ExpressionError extends Error {
  readonly expression: string;

  constructor(expression: string, message: string) {
    super(message);
    this.name = 'ExpressionError';
    this.expression = expression;
  }
}

export function compileExpression(expression: string) {
  const trimmed = expression.trim();
  if (!trimmed) throw new ExpressionError(expression, 'التعبير فارغ.');
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(expression, 'التعبير أطول من الحد المسموح (2000 حرف).');
  }
  try {
    return jsonata(trimmed);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'تعبير JSONata غير صالح.';
    throw new ExpressionError(expression, message);
  }
}

export function validateExpression(expression: string): string | null {
  try {
    compileExpression(expression);
    return null;
  } catch (caught) {
    return caught instanceof Error ? caught.message : 'تعبير غير صالح.';
  }
}

export async function evaluateExpression(
  expression: string,
  context: Record<string, unknown>,
  input: unknown = context,
): Promise<unknown> {
  const compiled = compileExpression(expression);
  const result = await Promise.resolve(compiled.evaluate(input, context));
  return result;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Resolves `{{ JSONata }}` blocks. A string that is exactly one expression
 * keeps the native value type (number, object, boolean…); mixed strings are
 * concatenated.
 */
export async function interpolateString(
  template: string,
  context: Record<string, unknown>,
  input?: unknown,
): Promise<unknown> {
  const whole = WHOLE_EXPRESSION.exec(template);
  if (whole) return evaluateExpression(whole[1]!, context, input);

  if (!template.includes('{{')) return template;

  let output = '';
  let lastIndex = 0;
  for (const match of template.matchAll(INTERPOLATION)) {
    const index = match.index ?? 0;
    output += template.slice(lastIndex, index);
    output += stringify(await evaluateExpression(match[1]!, context, input));
    lastIndex = index + match[0].length;
  }
  output += template.slice(lastIndex);
  return output;
}

export async function resolveTemplates(
  value: unknown,
  context: Record<string, unknown>,
  input?: unknown,
): Promise<unknown> {
  if (typeof value === 'string') return interpolateString(value, context, input);
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => resolveTemplates(entry, context, input)));
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([key, entry]) => [
        key,
        await resolveTemplates(entry, context, input),
      ]),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

export function validateExpressionsIn(value: unknown, basePath = ''): ExpressionIssue[] {
  const issues: ExpressionIssue[] = [];

  function walk(current: unknown, path: string): void {
    if (typeof current === 'string') {
      if (!current.includes('{{')) return;

      const opens = current.match(/\{\{/g)?.length ?? 0;
      const closes = current.match(/\}\}/g)?.length ?? 0;
      if (opens !== closes) {
        issues.push({
          path,
          expression: current,
          message: 'أقواس التعبير غير مغلقة ({{ … }}).',
        });
        return;
      }

      for (const match of current.matchAll(INTERPOLATION)) {
        const expression = match[1] ?? '';
        const error = validateExpression(expression);
        if (error) {
          issues.push({ path, expression, message: error });
        }
      }
      return;
    }

    if (Array.isArray(current)) {
      current.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }

    if (current && typeof current === 'object') {
      for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
        walk(entry, path ? `${path}.${key}` : key);
      }
    }
  }

  walk(value, basePath);
  return issues;
}
