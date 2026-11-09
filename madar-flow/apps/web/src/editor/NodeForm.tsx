import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CREDENTIAL_TYPE_LABELS,
  HTTP_CREDENTIAL_TYPES,
  IF_OPERATOR_LABELS,
  IF_OPERATORS,
  validateExpressionsIn,
  validateNodeParameters,
  type CredentialType,
  type IfOperator,
} from '@madar/shared/browser';
import { api, type CredentialMetadata } from '../api';
import type { MadarNode } from './store';
import { metaFor } from './node-catalog';

type Params = Record<string, unknown>;

interface NodeFormProps {
  node: MadarNode;
  canEdit: boolean;
  workspaceId?: string;
  onChange: (patch: Partial<MadarNode['data']>) => void;
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      entry === null || entry === undefined ? '' : String(entry),
    ]),
  );
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function NodeForm({ node, canEdit, workspaceId, onChange }: NodeFormProps) {
  const parameters = node.data.parameters ?? {};
  const meta = metaFor(node.data.nodeType);

  const issues = useMemo(
    () => [
      ...validateNodeParameters(node.data.nodeType, parameters).map((issue) => issue.message),
      ...validateExpressionsIn(parameters).map((issue) => issue.message),
    ],
    [node.data.nodeType, parameters],
  );

  function setParams(next: Params): void {
    onChange({ parameters: next });
  }

  function setField(key: string, value: unknown): void {
    setParams({ ...parameters, [key]: value });
  }

  return (
    <div className="mt-4 space-y-4">
      {issues.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
          <p className="text-[11px] font-bold text-amber-300">تحقق العقدة</p>
          <ul className="mt-1 space-y-1 text-[11px] leading-5 text-amber-200/80">
            {issues.slice(0, 4).map((issue, index) => (
              <li key={index}>• {issue}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-amber-200/50">
            المسودة تُحفظ حتى لو كانت ناقصة، لكن النشر يتطلب تحققًا كاملًا.
          </p>
        </div>
      )}

      {node.data.nodeType === 'manual' && (
        <p className="rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs leading-6 text-slate-400">
          يُشغّل هذا الـ Workflow يدويًا من زر التشغيل في المحرر أو من صفحة التنفيذات.
        </p>
      )}

      {node.data.nodeType === 'noop' && (
        <p className="rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs leading-6 text-slate-400">
          عقدة مرور صريحة: تستقبل العناصر وتعيدها كما هي. مفيدة لتوثيق الرسم أو نقطة دمج.
        </p>
      )}

      {node.data.nodeType === 'error' && (
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={Boolean(parameters.continueOnError)}
            onChange={(event) => setField('continueOnError', event.target.checked)}
            disabled={!canEdit}
            className="size-4 accent-rose-500"
          />
          متابعة التنفيذ بعد الخطأ
        </label>
      )}

      {node.data.nodeType === 'http' && (
        <HttpForm
          parameters={parameters}
          canEdit={canEdit}
          setField={setField}
          workspaceId={workspaceId}
        />
      )}

      {node.data.nodeType === 'set' && (
        <SetForm parameters={parameters} canEdit={canEdit} setField={setField} />
      )}

      {node.data.nodeType === 'if' && (
        <IfForm parameters={parameters} canEdit={canEdit} setParams={setParams} />
      )}

      {node.data.nodeType === 'merge' && (
        <MergeForm parameters={parameters} canEdit={canEdit} setField={setField} />
      )}

      {node.data.nodeType === 'schedule' && (
        <ScheduleForm parameters={parameters} canEdit={canEdit} setField={setField} />
      )}

      {node.data.nodeType === 'webhook' && (
        <WebhookForm
          parameters={parameters}
          canEdit={canEdit}
          setField={setField}
          workspaceId={workspaceId}
        />
      )}

      {!['manual', 'noop', 'error', 'http', 'set', 'if', 'merge', 'schedule', 'webhook'].includes(
        node.data.nodeType,
      ) && (
        <p className="rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs text-slate-400">
          {meta.label}: استخدم تبويب JSON لتحرير المعاملات.
        </p>
      )}

      <p className="rounded-lg bg-slate-900/60 p-2.5 text-[10px] leading-5 text-slate-500">
        استخدم <code dir="ltr" className="text-sky-400">{'{{ $json.field }}'}</code> للوصول إلى بيانات
        العنصر، و<code dir="ltr" className="text-sky-400">{'{{ $node["اسم"].json }}'}</code> لمخرجات
        عقدة سابقة.
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-400">
        {label}
        {hint && <span className="font-normal text-slate-600">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/50 disabled:opacity-60';

const selectClass =
  'w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none focus:border-sky-400/50 disabled:opacity-60';

function HttpForm({
  parameters,
  canEdit,
  setField,
  workspaceId,
}: {
  parameters: Params;
  canEdit: boolean;
  setField: (key: string, value: unknown) => void;
  workspaceId?: string;
}) {
  const retry = (parameters.retry ?? {}) as Record<string, unknown>;
  const bodyType = String(parameters.bodyType ?? 'none');
  const body = typeof parameters.body === 'string' ? parameters.body : '';

  return (
    <>
      <div className="grid grid-cols-[110px_1fr] gap-2">
        <Field label="الطريقة">
          <select
            value={String(parameters.method ?? 'GET')}
            onChange={(event) => setField('method', event.target.value)}
            disabled={!canEdit}
            className={selectClass}
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الرابط" hint="يدعم {{ … }}">
          <input
            value={String(parameters.url ?? '')}
            onChange={(event) => setField('url', event.target.value)}
            disabled={!canEdit}
            dir="ltr"
            placeholder="https://api.example.com/orders"
            className={inputClass}
          />
        </Field>
      </div>

      <CredentialField
        workspaceId={workspaceId}
        nodeType="http"
        value={parameters.credentialId}
        canEdit={canEdit}
        onChange={(credentialId) => setField('credentialId', credentialId)}
      />

      <Field label="الترويسات (Headers)">
        <KeyValueEditor
          value={asRecord(parameters.headers)}
          onChange={(next) => setField('headers', next)}
          disabled={!canEdit}
          keyPlaceholder="Authorization"
          valuePlaceholder="Bearer {{ $json.token }}"
        />
      </Field>

      <Field label="معاملات الاستعلام (Query)">
        <KeyValueEditor
          value={asRecord(parameters.query)}
          onChange={(next) => setField('query', next)}
          disabled={!canEdit}
          keyPlaceholder="page"
          valuePlaceholder="1"
        />
      </Field>

      <Field label="جسم الطلب">
        <select
          value={bodyType}
          onChange={(event) => setField('bodyType', event.target.value)}
          disabled={!canEdit}
          className={selectClass}
        >
          <option value="none">بدون</option>
          <option value="json">JSON</option>
          <option value="text">نص</option>
          <option value="form">Form</option>
        </select>
      </Field>

      {bodyType !== 'none' && (
        <textarea
          value={body}
          onChange={(event) => setField('body', event.target.value)}
          disabled={!canEdit}
          rows={6}
          dir="ltr"
          spellCheck={false}
          placeholder={bodyType === 'json' ? '{ "name": "{{ $json.name }}" }' : 'body'}
          className={`${inputClass} resize-y font-mono leading-5`}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="المهلة (ms)">
          <input
            type="number"
            min={1000}
            max={120000}
            step={1000}
            value={asNumber(parameters.timeoutMs, 30000)}
            onChange={(event) => setField('timeoutMs', Number(event.target.value))}
            disabled={!canEdit}
            className={inputClass}
            dir="ltr"
          />
        </Field>
        <Field label="محاولات إعادة (Retries)">
          <input
            type="number"
            min={1}
            max={10}
            value={asNumber(retry.maxAttempts, 1)}
            onChange={(event) =>
              setField('retry', {
                maxAttempts: Number(event.target.value),
                backoffMs: asNumber(retry.backoffMs, 1000),
              })
            }
            disabled={!canEdit}
            className={inputClass}
            dir="ltr"
          />
        </Field>
      </div>
    </>
  );
}

function SetForm({
  parameters,
  canEdit,
  setField,
}: {
  parameters: Params;
  canEdit: boolean;
  setField: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <Field label="القيم" hint="القيم النصية تدعم {{ … }}">
        <KeyValueEditor
          value={asRecord(parameters.values)}
          onChange={(next) => setField('values', next)}
          disabled={!canEdit}
          keyPlaceholder="status"
          valuePlaceholder="{{ $json.status }}"
        />
      </Field>
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={Boolean(parameters.keepOnlySet)}
          onChange={(event) => setField('keepOnlySet', event.target.checked)}
          disabled={!canEdit}
          className="size-4 accent-sky-500"
        />
        الاحتفاظ بالقيم المعيّنة فقط (حذف بقية الحقول)
      </label>
    </>
  );
}

interface ConditionRow {
  left?: string;
  operator?: IfOperator;
  right?: string;
}

function IfForm({
  parameters,
  canEdit,
  setParams,
}: {
  parameters: Params;
  canEdit: boolean;
  setParams: (next: Params) => void;
}) {
  const conditions = Array.isArray(parameters.conditions)
    ? (parameters.conditions as ConditionRow[])
    : [];

  function updateCondition(index: number, patch: Partial<ConditionRow>): void {
    const next = conditions.map((condition, position) =>
      position === index ? { ...condition, ...patch } : condition,
    );
    setParams({ ...parameters, conditions: next });
  }

  function addCondition(): void {
    setParams({
      ...parameters,
      conditions: [...conditions, { left: '', operator: 'equals', right: '' }],
    });
  }

  function removeCondition(index: number): void {
    setParams({
      ...parameters,
      conditions: conditions.filter((_, position) => position !== index),
    });
  }

  const unaryOperators = new Set(['exists', 'notExists', 'isEmpty', 'isNotEmpty']);

  return (
    <>
      {conditions.length > 1 && (
        <Field label="طريقة الدمج">
          <select
            value={String(parameters.combinator ?? 'and')}
            onChange={(event) => setParams({ ...parameters, combinator: event.target.value })}
            disabled={!canEdit}
            className={selectClass}
          >
            <option value="and">كل الشروط (AND)</option>
            <option value="or">أي شرط (OR)</option>
          </select>
        </Field>
      )}

      <div className="space-y-2">
        {conditions.map((condition, index) => (
          <div
            key={index}
            className="space-y-2 rounded-xl border border-white/10 bg-slate-900/60 p-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500">شرط {index + 1}</span>
              <button
                type="button"
                onClick={() => removeCondition(index)}
                disabled={!canEdit || conditions.length === 1}
                className="text-[10px] text-rose-400 disabled:opacity-30"
              >
                حذف
              </button>
            </div>
            <input
              value={condition.left ?? ''}
              onChange={(event) => updateCondition(index, { left: event.target.value })}
              disabled={!canEdit}
              dir="ltr"
              placeholder="{{ $json.status }}"
              className={inputClass}
            />
            <select
              value={condition.operator ?? 'equals'}
              onChange={(event) =>
                updateCondition(index, { operator: event.target.value as IfOperator })
              }
              disabled={!canEdit}
              className={selectClass}
            >
              {IF_OPERATORS.map((operator) => (
                <option key={operator} value={operator}>
                  {IF_OPERATOR_LABELS[operator]}
                </option>
              ))}
            </select>
            {!unaryOperators.has(condition.operator ?? 'equals') && (
              <input
                value={condition.right ?? ''}
                onChange={(event) => updateCondition(index, { right: event.target.value })}
                disabled={!canEdit}
                dir="ltr"
                placeholder="200"
                className={inputClass}
              />
            )}
            {condition.operator === 'regex' && (
              <p className="text-[10px] text-slate-500" dir="ltr">
                مثال: ^2\d\d$
              </p>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addCondition}
        disabled={!canEdit}
        className="w-full rounded-xl border border-dashed border-white/15 px-3 py-2 text-[11px] font-semibold text-slate-400 transition hover:border-sky-400/30 hover:text-sky-300 disabled:opacity-50"
      >
        + إضافة شرط
      </button>
    </>
  );
}

function MergeForm({
  parameters,
  canEdit,
  setField,
}: {
  parameters: Params;
  canEdit: boolean;
  setField: (key: string, value: unknown) => void;
}) {
  const mode = String(parameters.mode ?? 'append');
  return (
    <>
      <Field label="طريقة الدمج">
        <select
          value={mode}
          onChange={(event) => setField('mode', event.target.value)}
          disabled={!canEdit}
          className={selectClass}
        >
          <option value="append">إلحاق كل العناصر</option>
          <option value="mergeByIndex">دمج حسب الترتيب</option>
          <option value="mergeByKey">دمج حسب حقل</option>
        </select>
      </Field>
      {mode === 'mergeByKey' && (
        <Field label="حقل المفتاح">
          <input
            value={String(parameters.key ?? '')}
            onChange={(event) => setField('key', event.target.value)}
            disabled={!canEdit}
            dir="ltr"
            placeholder="id"
            className={inputClass}
          />
        </Field>
      )}
    </>
  );
}

const CRON_PRESETS = [
  { label: 'كل 15 دقيقة', value: '*/15 * * * *' },
  { label: 'كل ساعة', value: '0 * * * *' },
  { label: 'يوميًا 9 صباحًا', value: '0 9 * * *' },
  { label: 'أسبوعيًا (الأحد 8ص)', value: '0 8 * * 0' },
];

const TIMEZONES = [
  'Africa/Cairo',
  'UTC',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Amman',
  'Africa/Casablanca',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
];

function ScheduleForm({
  parameters,
  canEdit,
  setField,
}: {
  parameters: Params;
  canEdit: boolean;
  setField: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <Field label="تعبير Cron" hint="5 حقول">
        <input
          value={String(parameters.cron ?? '')}
          onChange={(event) => setField('cron', event.target.value)}
          disabled={!canEdit}
          dir="ltr"
          placeholder="0 9 * * *"
          className={`${inputClass} font-mono`}
        />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {CRON_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => setField('cron', preset.value)}
            disabled={!canEdit}
            className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-400 transition hover:border-sky-400/30 hover:text-sky-300 disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <Field label="المنطقة الزمنية">
        <select
          value={String(parameters.timezone ?? 'Africa/Cairo')}
          onChange={(event) => setField('timezone', event.target.value)}
          disabled={!canEdit}
          className={selectClass}
        >
          {TIMEZONES.map((timezone) => (
            <option key={timezone} value={timezone}>
              {timezone}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

function WebhookForm({
  parameters,
  canEdit,
  setField,
  workspaceId,
}: {
  parameters: Params;
  canEdit: boolean;
  setField: (key: string, value: unknown) => void;
  workspaceId?: string;
}) {
  const path = String(parameters.path ?? '');
  const url =
    workspaceId && path
      ? `${window.location.origin}/api/v1/webhooks/${workspaceId}/${path}`
      : '';

  return (
    <>
      <Field label="المسار" hint="يجب أن يكون فريدًا داخل المساحة">
        <input
          value={String(parameters.path ?? '')}
          onChange={(event) => setField('path', event.target.value)}
          disabled={!canEdit}
          dir="ltr"
          placeholder="incoming-orders"
          className={inputClass}
        />
      </Field>
      <Field label="الطريقة">
        <select
          value={String(parameters.method ?? 'POST')}
          onChange={(event) => setField('method', event.target.value)}
          disabled={!canEdit}
          className={selectClass}
        >
          {['POST', 'GET', 'PUT'].map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
      </Field>
      <CredentialField
        workspaceId={workspaceId}
        nodeType="webhook"
        value={parameters.credentialId}
        canEdit={canEdit}
        onChange={(credentialId) => setField('credentialId', credentialId)}
      />

      <Field label="رابط الاستقبال" hint="يتطلب توقيع HMAC">
        <div className="flex items-start gap-1.5">
          <code
            dir="ltr"
            className="min-w-0 flex-1 break-all rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-left text-[10px] leading-5 text-sky-300"
          >
            {url || 'حدّد مسارًا لعرض الرابط.'}
          </code>
          {url && (
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(url)}
              className="shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-[10px] text-slate-300 transition hover:bg-white/5"
            >
              نسخ
            </button>
          )}
        </div>
      </Field>

      <p className="rounded-lg bg-slate-900/60 p-2.5 text-[10px] leading-5 text-slate-500">
        يُرسل المرسِل الترويسات <code dir="ltr" className="text-sky-400">x-madar-timestamp</code> و
        <code dir="ltr" className="text-sky-400">x-madar-signature</code> و
        <code dir="ltr" className="text-sky-400">x-madar-delivery</code>؛ التوقيع هو
        HMAC-SHA256 على <code dir="ltr">{'${timestamp}.${rawBody}'}</code>.
      </p>
    </>
  );
}

function CredentialField({
  workspaceId,
  nodeType,
  value,
  canEdit,
  onChange,
}: {
  workspaceId?: string;
  nodeType: 'http' | 'webhook';
  value: unknown;
  canEdit: boolean;
  onChange: (credentialId: string | null) => void;
}) {
  const allowed: readonly CredentialType[] =
    nodeType === 'webhook' ? ['hmac'] : HTTP_CREDENTIAL_TYPES;

  const credentialsQuery = useQuery({
    queryKey: ['credentials', workspaceId, 'active'],
    queryFn: () =>
      api<CredentialMetadata[]>(`/workspaces/${workspaceId}/credentials?includeRevoked=false`),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });

  const active = (credentialsQuery.data ?? []).filter(
    (credential) => !credential.revokedAt && allowed.includes(credential.type as CredentialType),
  );

  const current = typeof value === 'string' ? value : '';
  const currentMissing = current !== '' && !active.some((credential) => credential.id === current);

  return (
    <Field
      label={nodeType === 'webhook' ? 'اعتماد HMAC' : 'الاعتماد (اختياري)'}
      hint={nodeType === 'webhook' ? 'مطلوب للنشر' : undefined}
    >
      <select
        value={current}
        onChange={(event) => onChange(event.target.value || null)}
        disabled={!canEdit}
        className={selectClass}
      >
        <option value="">{nodeType === 'webhook' ? 'اختر اعتمادًا…' : 'بدون اعتماد'}</option>
        {active.map((credential) => (
          <option key={credential.id} value={credential.id}>
            {credential.name} ·{' '}
            {CREDENTIAL_TYPE_LABELS[credential.type as CredentialType] ?? credential.type}
          </option>
        ))}
      </select>

      {currentMissing && (
        <p className="mt-1 text-[10px] text-rose-300">
          الاعتماد المحدد غير متاح (ملغى أو غير موجود). اختر اعتمادًا آخر قبل النشر.
        </p>
      )}

      {workspaceId && active.length === 0 && (
        <p className="mt-1 text-[10px] text-slate-500">
          لا توجد اعتمادات مناسبة.{' '}
          <Link to={`/w/${workspaceId}/credentials`} className="text-sky-400 hover:text-sky-300">
            أضف اعتمادًا
          </Link>
          .
        </p>
      )}
    </Field>
  );
}

function KeyValueEditor({
  value,
  onChange,
  disabled,
  keyPlaceholder,
  valuePlaceholder,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled: boolean;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const entries = Object.entries(value);

  function updateEntry(index: number, key: string, entryValue: string): void {
    const next: Record<string, string> = {};
    entries.forEach(([existingKey, existingValue], position) => {
      if (position === index) {
        if (key.trim()) next[key] = entryValue;
      } else {
        next[existingKey] = existingValue;
      }
    });
    onChange(next);
  }

  return (
    <div className="space-y-1.5">
      {entries.map(([key, entryValue], index) => (
        <div key={index} className="flex gap-1.5">
          <input
            value={key}
            onChange={(event) => updateEntry(index, event.target.value, entryValue)}
            disabled={disabled}
            dir="ltr"
            placeholder={keyPlaceholder}
            className={`${inputClass} w-2/5`}
          />
          <input
            value={entryValue}
            onChange={(event) => updateEntry(index, key, event.target.value)}
            disabled={disabled}
            dir="ltr"
            placeholder={valuePlaceholder}
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            onClick={() => {
              const next = { ...value };
              delete next[key];
              onChange(next);
            }}
            disabled={disabled}
            className="shrink-0 rounded-lg border border-white/10 px-2 text-[11px] text-rose-400 transition hover:bg-white/5 disabled:opacity-40"
            aria-label="حذف"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          let key = `key${entries.length + 1}`;
          while (key in value) key = `${key}_`;
          onChange({ ...value, [key]: '' });
        }}
        disabled={disabled}
        className="w-full rounded-lg border border-dashed border-white/15 px-2 py-1.5 text-[10px] font-semibold text-slate-500 transition hover:border-sky-400/30 hover:text-sky-300 disabled:opacity-50"
      >
        + إضافة حقل
      </button>
    </div>
  );
}
