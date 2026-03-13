import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@/contexts/ThemeContext';
import type { PrometheusChartBlock } from '@/lib/types';

// ── Color palettes ─────────────────────────────────────────────────────────────

const DARK_COLORS = ['#f6c90e', '#73bf69', '#f44747', '#60a5fa', '#a78bfa'];
const LIGHT_COLORS = ['#d97706', '#16a34a', '#dc2626', '#2563eb', '#7c3aed'];

// ── Time formatter ─────────────────────────────────────────────────────────────

function formatTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Custom Tooltip ─────────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
  unit,
  isDark,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
  unit: string;
  isDark: boolean;
}) {
  if (!active || !payload?.length) return null;
  const bg = isDark ? '#1f2937' : '#ffffff';
  const border = isDark ? '#374151' : '#e5e7eb';
  const text = isDark ? '#e2e8f0' : '#111827';
  const sub = isDark ? '#9ca3af' : '#6b7280';

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 11,
        color: text,
      }}
    >
      <div style={{ color: sub, marginBottom: 4 }}>{formatTime(label ?? 0)}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{p.value.toFixed(1)}{unit}</strong>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface PrometheusChartCardProps {
  block: PrometheusChartBlock;
}

export function PrometheusChartCard({ block }: PrometheusChartCardProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  const cardBg = isDark ? '#111827' : '#f9fafb';
  const headerBg = isDark ? '#1f2937' : '#f3f4f6';
  const border = isDark ? '#374151' : '#e5e7eb';
  const gridColor = isDark ? '#1f2937' : '#f3f4f6';
  const textColor = isDark ? '#e2e8f0' : '#111827';
  const subColor = isDark ? '#9ca3af' : '#6b7280';

  // Convert series data to Recharts format: [{ ts, "ip1": val, "ip2": val }, ...]
  const allTimestamps = [
    ...new Set(block.series.flatMap((s) => s.data.map(([ts]) => ts))),
  ].sort((a, b) => a - b);

  const chartData = allTimestamps.map((ts) => {
    const point: Record<string, number> = { ts };
    for (const series of block.series) {
      const entry = series.data.find(([t]) => t === ts);
      if (entry) point[series.instance] = parseFloat(entry[1].toFixed(2));
    }
    return point;
  });

  // Latest value per series (shown in legend)
  const latestValues: Record<string, number> = {};
  for (const series of block.series) {
    if (series.data.length > 0) {
      latestValues[series.instance] = parseFloat(
        series.data[series.data.length - 1][1].toFixed(1),
      );
    }
  }

  const hasData = chartData.length > 0;

  return (
    <div
      style={{
        background: cardBg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        overflow: 'hidden',
        marginTop: 8,
        marginBottom: 4,
      }}
    >
      {/* Card header */}
      <div
        style={{
          background: headerBg,
          borderBottom: `1px solid ${border}`,
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>📊</span>
          <span style={{ color: textColor, fontSize: 12, fontWeight: 600 }}>
            {block.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              background: isDark ? '#374151' : '#e5e7eb',
              color: subColor,
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 3,
            }}
          >
            Last {block.timeRange}
          </span>
          {block.datasource && (
            <span style={{ color: subColor, fontSize: 10 }}>{block.datasource}</span>
          )}
        </div>
      </div>

      {/* Legend */}
      {hasData && (
        <div
          style={{
            padding: '6px 12px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 16px',
            borderBottom: `1px solid ${isDark ? '#1f2937' : '#f3f4f6'}`,
          }}
        >
          {block.series.map((s, i) => (
            <span key={s.instance} style={{ color: colors[i % colors.length], fontSize: 11 }}>
              ● {s.instance}
              {latestValues[s.instance] !== undefined && (
                <strong>
                  {'  '}
                  {latestValues[s.instance]}
                  {block.unit}
                </strong>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Chart area */}
      <div style={{ padding: '8px 4px 4px' }}>
        {!hasData ? (
          <div
            style={{
              textAlign: 'center',
              color: subColor,
              fontSize: 12,
              padding: '24px 0',
            }}
          >
            暂无数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis
                dataKey="ts"
                tickFormatter={formatTime}
                tick={{ fill: subColor, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                tick={{ fill: subColor, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v) => `${v}${block.unit}`}
              />
              <Tooltip
                content={<CustomTooltip unit={block.unit} isDark={isDark} />}
                isAnimationActive={false}
              />
              {block.series.map((s, i) => (
                <Line
                  key={s.instance}
                  type="monotone"
                  dataKey={s.instance}
                  stroke={colors[i % colors.length]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
