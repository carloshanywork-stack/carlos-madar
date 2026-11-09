import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { metaFor } from './node-catalog';
import type { MadarNode } from './store';

const ACCENTS: Record<
  string,
  { border: string; iconBg: string; iconText: string; glow: string; dot: string }
> = {
  emerald: {
    border: 'border-emerald-400/30',
    iconBg: 'bg-emerald-400/10',
    iconText: 'text-emerald-300',
    glow: 'shadow-emerald-500/10',
    dot: 'bg-emerald-400',
  },
  sky: {
    border: 'border-sky-400/30',
    iconBg: 'bg-sky-400/10',
    iconText: 'text-sky-300',
    glow: 'shadow-sky-500/10',
    dot: 'bg-sky-400',
  },
  violet: {
    border: 'border-violet-400/30',
    iconBg: 'bg-violet-400/10',
    iconText: 'text-violet-300',
    glow: 'shadow-violet-500/10',
    dot: 'bg-violet-400',
  },
  amber: {
    border: 'border-amber-400/30',
    iconBg: 'bg-amber-400/10',
    iconText: 'text-amber-300',
    glow: 'shadow-amber-500/10',
    dot: 'bg-amber-400',
  },
  cyan: {
    border: 'border-cyan-400/30',
    iconBg: 'bg-cyan-400/10',
    iconText: 'text-cyan-300',
    glow: 'shadow-cyan-500/10',
    dot: 'bg-cyan-400',
  },
  slate: {
    border: 'border-slate-400/25',
    iconBg: 'bg-slate-400/10',
    iconText: 'text-slate-300',
    glow: 'shadow-slate-500/10',
    dot: 'bg-slate-400',
  },
  rose: {
    border: 'border-rose-400/30',
    iconBg: 'bg-rose-400/10',
    iconText: 'text-rose-300',
    glow: 'shadow-rose-500/10',
    dot: 'bg-rose-400',
  },
};

const fallbackAccent = ACCENTS.slate!;

export const MadarNodeView = memo(function MadarNodeView({
  data,
  selected,
}: NodeProps<MadarNode>) {
  const meta = metaFor(data.nodeType);
  const accent = ACCENTS[meta.accent] ?? fallbackAccent;
  const isTrigger = meta.group === 'trigger';

  return (
    <div
      dir="rtl"
      className={`w-56 rounded-2xl border bg-slate-900/95 px-4 py-3 shadow-xl backdrop-blur transition ${accent.border} ${accent.glow} ${
        selected ? 'ring-2 ring-sky-400/70' : ''
      } ${data.disabled ? 'opacity-40' : ''}`}
    >
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          className="!size-2.5 !border-2 !border-slate-950 !bg-slate-400"
        />
      )}

      <div className="flex items-center gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl text-sm font-black ${accent.iconBg} ${accent.iconText}`}
        >
          {meta.icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-100">{data.label}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className={`size-1.5 rounded-full ${accent.dot}`} />
            <span dir="ltr">{data.nodeType}</span>
          </p>
        </div>
      </div>

      {meta.outputs.length === 1 && (
        <Handle
          type="source"
          position={Position.Right}
          className="!size-2.5 !border-2 !border-slate-950 !bg-sky-400"
        />
      )}

      {meta.outputs.length > 1 && (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: '38%' }}
            className="!size-2.5 !border-2 !border-slate-950 !bg-emerald-400"
          />
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: '72%' }}
            className="!size-2.5 !border-2 !border-slate-950 !bg-rose-400"
          />
          <div className="mt-2 flex items-center justify-end gap-3 border-t border-white/5 pt-1.5 text-[9px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-400" /> نعم
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-rose-400" /> لا
            </span>
          </div>
        </>
      )}
    </div>
  );
});
