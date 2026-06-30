"use client";
import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, Card, Loading } from "@/components/ui";
import { ROUTES } from "@/app/_components/routes";

// ─── Types ────────────────────────────────────────────
interface HourlyMetric {
  hour: string;
  request_count: number;
  success_count: number;
  error_count: number;
  timeout_count: number;
  fallback_count: number;
  latency_p50: number | null;
  latency_p95: number | null;
  latency_avg: number | null;
  ttft_p50: number | null;
  tokens_total: number;
  cost_total_usd: number;
  tool_call_total: number;
}

interface AlertRecord {
  id: string;
  alert_name: string;
  severity: string;
  metric_name: string;
  metric_value: number;
  threshold: number;
  condition_desc: string;
  resolved: boolean;
  created_at: string;
}

interface DailyCost {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}

interface DashboardData {
  metrics: HourlyMetric[];
  alerts: AlertRecord[];
  dailyCost: DailyCost[];
  summary: {
    totalRequests: number;
    successRate: number;
    avgLatency: number;
    p95Latency: number;
    totalCost: number;
    totalTokens: number;
  };
}

// ─── Stat Card ────────────────────────────────────────
function StatCard({ label, value, unit, trend, status }: {
  label: string; value: string; unit?: string; trend?: string; status?: "ok" | "warn" | "error";
}) {
  const dotColor = status === "error" ? "var(--red)" : status === "warn" ? "var(--yellow)" : "var(--green)";
  return (
    <Card padding={16} borderRadius="var(--radius-lg)" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full" style={{ background: dotColor }} />
        <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</span>
        {unit && <span className="text-sm" style={{ color: 'var(--text-dim)' }}>{unit}</span>}
      </div>
      {trend && <span className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>{trend}</span>}
    </Card>
  );
}

// ─── Simple Bar Chart ─────────────────────────────────
function BarChart({ data, labelKey, valueKey, height = 120 }: {
  data: any[]; labelKey: string; valueKey: string; height?: number;
}) {
  const { t } = useI18n();
  if (!data.length) return <div className="text-sm p-4" style={{ color: 'var(--text-dim)' }}>{t("observability.no_data")}</div>;
  const maxVal = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  return (
    <div className="flex items-end gap-1 h-[120px] px-2" style={{ height }}>
      {data.slice(-24).map((d, i) => {
        const val = Number(d[valueKey]) || 0;
        const pct = (val / maxVal) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d[labelKey]}: ${val}`}>
            <div
              className="w-full rounded-t-sm transition-all"
              style={{ height: `${Math.max(pct, 2)}%`, background: 'var(--cyan)', opacity: 0.7 }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Alert List ───────────────────────────────────────
function AlertList({ alerts }: { alerts: AlertRecord[] }) {
  const { t } = useI18n();
  if (!alerts.length) return <div className="text-sm p-4" style={{ color: 'var(--text-dim)' }}>{t("observability.no_alerts")}</div>;
  const severityIcon: Record<string, string> = { critical: "!!!", warning: "!!", info: "i" };
  const severityColor: Record<string, string> = { critical: "var(--red)", warning: "var(--yellow)", info: "var(--cyan)" };
  return (
    <div className="space-y-2 max-h-[200px] overflow-y-auto">
      {alerts.slice(0, 10).map((a) => (
        <div key={a.id} className="flex items-start gap-2 text-sm">
          <span className="font-mono font-bold" style={{ color: severityColor[a.severity] || 'var(--text-dim)' }}>
            [{severityIcon[a.severity] || "?"}]
          </span>
          <div className="flex-1 min-w-0">
            <div className="truncate" style={{ color: 'var(--text-primary)' }}>{a.alert_name}</div>
            <div className="text-xs truncate" style={{ color: 'var(--text-dim)' }}>{a.condition_desc}</div>
          </div>
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-dim)' }}>
            {new Date(a.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Cost Table ───────────────────────────────────────
function CostTable({ data }: { data: DailyCost[] }) {
  const { t } = useI18n();
  if (!data.length) return <div className="text-sm p-4" style={{ color: 'var(--text-dim)' }}>{t("observability.no_cost")}</div>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs uppercase border-b" style={{ color: 'var(--text-dim)', borderColor: 'var(--border)' }}>
          <th className="text-left py-2">{t("observability.col_date")}</th>
          <th className="text-right py-2">{t("observability.col_requests")}</th>
          <th className="text-right py-2">{t("observability.col_tokens")}</th>
          <th className="text-right py-2">{t("observability.col_cost")}</th>
        </tr>
      </thead>
      <tbody>
        {data.slice(0, 7).map((d) => (
          <tr key={d.date} className="border-b" style={{ borderColor: 'var(--border)' }}>
            <td className="py-1.5" style={{ color: 'var(--text-secondary)' }}>{d.date}</td>
            <td className="py-1.5 text-right" style={{ color: 'var(--text-dim)' }}>{d.requests.toLocaleString()}</td>
            <td className="py-1.5 text-right" style={{ color: 'var(--text-dim)' }}>{(d.tokens / 1000).toFixed(1)}k</td>
            <td className="py-1.5 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
              ${Number(d.cost).toFixed(4)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Main Dashboard ───────────────────────────────────
function ObservabilityDashboardInner() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const hours = Number(searchParams.get("hours") || 24);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/observability/dashboard?hours=${hours}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const timer = setInterval(fetchData, 30_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  if (loading && !data) {
    return <Loading />;
  }

  if (error && !data) {
    return (
      <div className="p-8 text-center">
        <div className="mb-2" style={{ color: 'var(--red)' }}>{t("observability.load_fail")}</div>
        <div className="text-sm" style={{ color: 'var(--text-dim)' }}>{error}</div>
        <Button variant="secondary" onClick={fetchData}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const s = data?.summary;
  const successStatus = s ? (s.successRate >= 0.99 ? "ok" : s.successRate >= 0.95 ? "warn" : "error") : undefined;
  const latencyStatus = s ? (s.p95Latency <= 10000 ? "ok" : s.p95Latency <= 15000 ? "warn" : "error") : undefined;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Navigation */}
      <Link href={ROUTES.HOME} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 12, textDecoration: 'none', marginBottom: 16 }}>
        {t("common.back_home")}
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-semibold" style={{ fontSize: 16, fontFamily: "var(--font-display)", color: "var(--cyan)" }}>
          {t("observability.title")}
        </h1>
        <div className="flex items-center gap-3">
          <select
            value={hours}
            onChange={(e) => window.location.href = `${ROUTES.MONITOR}?hours=${e.target.value}`}
            className="text-sm border rounded px-2 py-1"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)', color: 'var(--text-primary)' }}
          >
            <option value={1}>{t("observability.range_1h")}</option>
            <option value={6}>{t("observability.range_6h")}</option>
            <option value={24}>{t("observability.range_24h")}</option>
            <option value={72}>{t("observability.range_3d")}</option>
          </select>
          <button onClick={fetchData} className="text-sm" style={{ color: 'var(--text-dim)' }}>
            {t("observability.refresh")}
          </button>
        </div>
      </div>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Status"
          value={successStatus === "error" ? "Degraded" : successStatus === "warn" ? "Warning" : "Healthy"}
          status={successStatus}
        />
        <StatCard
          label={t("observability.requests")}
          value={s?.totalRequests.toLocaleString() || "0"}
          trend={`in ${hours}h`}
        />
        <StatCard
          label={t("observability.success_rate")}
          value={s ? `${(s.successRate * 100).toFixed(1)}` : "0"}
          unit="%"
          status={successStatus}
        />
        <StatCard
          label={t("observability.avg_latency")}
          value={s ? `${(s.avgLatency / 1000).toFixed(1)}` : "0"}
          unit="s"
        />
        <StatCard
          label={t("observability.p95_latency")}
          value={s ? `${(s.p95Latency / 1000).toFixed(1)}` : "0"}
          unit="s"
          status={latencyStatus}
        />
        <StatCard
          label={t("observability.cost")}
          value={s ? `$${s.totalCost.toFixed(2)}` : "$0"}
          trend={`${((s?.totalTokens || 0) / 1000).toFixed(0)}k tokens`}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Request Volume */}
        <Card padding={16} borderRadius="var(--radius-lg)" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>{t("observability.chart_volume")}</h3>
          <BarChart
            data={data?.metrics || []}
            labelKey="hour"
            valueKey="request_count"
          />
        </Card>

        {/* Success vs Error */}
        <Card padding={16} borderRadius="var(--radius-lg)" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>{t("observability.chart_success")}</h3>
          <div className="flex gap-4 text-xs mb-2" style={{ color: 'var(--text-dim)' }}>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'var(--green)', opacity: 0.7 }} /> {t("observability.success")}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'var(--red)', opacity: 0.7 }} /> {t("observability.error")}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'var(--yellow)', opacity: 0.7 }} /> {t("observability.timeout")}</span>
          </div>
          <BarChart
            data={data?.metrics || []}
            labelKey="hour"
            valueKey="success_count"
          />
        </Card>

        {/* Cost Trend */}
        <Card padding={16} borderRadius="var(--radius-lg)" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>{t("observability.chart_cost")}</h3>
          <CostTable data={data?.dailyCost || []} />
        </Card>

        {/* Recent Alerts */}
        <Card padding={16} borderRadius="var(--radius-lg)" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>{t("observability.alerts")}</h3>
          <AlertList alerts={data?.alerts || []} />
        </Card>
      </div>

      {/* Footer */}
      <div className="text-xs text-center" style={{ color: 'var(--text-dim)' }}>
        {t("observability.footer")}
      </div>
    </div>
  );
}

export default function ObservabilityDashboard() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: "var(--text-dim)" }}>Loading...</div>}>
      <ObservabilityDashboardInner />
    </Suspense>
  );
}
