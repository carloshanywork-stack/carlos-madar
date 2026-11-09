import type { IfOperator } from '@madar/shared';
import type { Item, NodeExecutionArgs, NodeExecutionResult } from '../types.js';
import {
  isPlainObject,
  itemJson,
  itemObject,
  resolveForItem,
  stringValue,
} from './helpers.js';

interface Condition {
  left?: unknown;
  operator?: string;
  right?: unknown;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

function looseEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === 'number' || typeof right === 'number') {
    const l = asNumber(left);
    const r = asNumber(right);
    if (Number.isFinite(l) && Number.isFinite(r)) return l === r;
  }
  return stringValue(left) === stringValue(right);
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

export function evaluateCondition(
  operator: IfOperator | string,
  left: unknown,
  right: unknown,
): boolean {
  switch (operator) {
    case 'equals':
      return looseEquals(left, right);
    case 'notEquals':
      return !looseEquals(left, right);
    case 'contains':
      if (Array.isArray(left)) return left.some((entry) => looseEquals(entry, right));
      return stringValue(left).includes(stringValue(right));
    case 'notContains':
      return !evaluateCondition('contains', left, right);
    case 'greaterThan':
      return asNumber(left) > asNumber(right);
    case 'lessThan':
      return asNumber(left) < asNumber(right);
    case 'greaterOrEqual':
      return asNumber(left) >= asNumber(right);
    case 'lessOrEqual':
      return asNumber(left) <= asNumber(right);
    case 'exists':
      return left !== undefined && left !== null;
    case 'notExists':
      return left === undefined || left === null;
    case 'isEmpty':
      return isEmpty(left);
    case 'isNotEmpty':
      return !isEmpty(left);
    case 'regex': {
      try {
        return new RegExp(stringValue(right)).test(stringValue(left));
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export async function executeIfNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
  const { node, input } = args;
  const rawConditions = Array.isArray(node.parameters.conditions)
    ? (node.parameters.conditions as Condition[])
    : [];
  const combinator = stringValue(node.parameters.combinator, 'and') === 'or' ? 'or' : 'and';

  const truthy: Item[] = [];
  const falsy: Item[] = [];

  for (const item of input) {
    let matches = combinator === 'and';
    for (const condition of rawConditions) {
      const left = await resolveForItem(condition.left ?? '', args, item);
      const right = await resolveForItem(condition.right ?? '', args, item);
      const result = evaluateCondition(condition.operator ?? 'equals', left, right);
      if (combinator === 'and' && !result) {
        matches = false;
        break;
      }
      if (combinator === 'or' && result) {
        matches = true;
        break;
      }
    }
    (matches ? truthy : falsy).push(item);
  }

  return { outputs: { true: truthy, false: falsy } };
}

export async function executeSetNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
  const { node, input } = args;
  const values = isPlainObject(node.parameters.values) ? node.parameters.values : {};
  const keepOnlySet = node.parameters.keepOnlySet === true;

  const output: Item[] = [];
  for (const item of input) {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      resolved[key] = await resolveForItem(value, args, item);
    }
    output.push({
      json: keepOnlySet ? resolved : { ...itemObject(item), ...resolved },
    });
  }

  return { outputs: { main: output } };
}

export async function executeMergeNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
  const { node, input } = args;
  const mode = stringValue(node.parameters.mode, 'append');
  const key = stringValue(node.parameters.key);

  if (mode === 'mergeByIndex') {
    const objects = input.map((item) => itemObject(item));
    const merged: Record<string, unknown> = {};
    for (const object of objects) Object.assign(merged, object);
    return { outputs: { main: [{ json: merged }] } };
  }

  if (mode === 'mergeByKey' && key) {
    const byKey = new Map<string, Record<string, unknown>>();
    for (const item of input) {
      const object = itemObject(item);
      const keyValue = stringValue(object[key]);
      if (!keyValue) continue;
      byKey.set(keyValue, { ...(byKey.get(keyValue) ?? {}), ...object });
    }
    return { outputs: { main: [...byKey.values()].map((json) => ({ json })) } };
  }

  return { outputs: { main: input } };
}

export async function executeNoopNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
  return { outputs: { main: args.input } };
}

export async function executeErrorNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
  return { outputs: { main: args.input } };
}

export async function executeTransformNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
  // Unknown types arrive here only for test-mode execution; publishing blocks them.
  return { outputs: { main: args.input } };
}

export function passthroughItem(item: Item): unknown {
  return itemJson(item);
}
