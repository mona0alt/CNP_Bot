import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Brain,
  FolderKanban,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const groupedMetrics = [
  {
    title: "平台态势",
    desc: "整体运行与风险摘要",
    items: [
      { label: "平台状态", value: "正常" },
      { label: "活跃 Agent", value: "12" },
      { label: "待关注项", value: "3" },
      { label: "成功率", value: "98.7%" },
    ],
    icon: ShieldCheck,
  },
  {
    title: "任务编排",
    desc: "任务规模与执行状态",
    items: [
      { label: "任务总数", value: "128" },
      { label: "运行中", value: "86" },
      { label: "待执行", value: "29" },
      { label: "异常", value: "5" },
    ],
    icon: FolderKanban,
  },
  {
    title: "资源消耗",
    desc: "推理与工具调用概况",
    items: [
      { label: "Token 消耗", value: "2.48M" },
      { label: "工具执行", value: "9,842" },
      { label: "平均响应", value: "2.3s" },
      { label: "高峰负载", value: "74%" },
    ],
    icon: Sparkles,
  },
  {
    title: "协作概况",
    desc: "会话与用户活跃度",
    items: [
      { label: "会话数量", value: "316" },
      { label: "在线人数", value: "18" },
      { label: "用户数量", value: "42" },
      { label: "技能数目", value: "24" },
    ],
    icon: Users,
  },
];

const taskList = [
  {
    name: "K8s 集群健康巡检",
    agent: "Cluster Agent",
    type: "Cron 定时",
    nextRun: "15 分钟后",
    status: "运行中",
    statusClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-300 dark:ring-emerald-500/25",
  },
  {
    name: "发布后回归检查",
    agent: "Release Agent",
    type: "单次任务",
    nextRun: "今天 17:30",
    status: "待执行",
    statusClass:
      "bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/12 dark:text-sky-300 dark:ring-sky-500/25",
  },
  {
    name: "成本波动监测",
    agent: "FinOps Agent",
    type: "间隔执行",
    nextRun: "1 小时后",
    status: "运行中",
    statusClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-300 dark:ring-emerald-500/25",
  },
  {
    name: "异常日志摘要生成",
    agent: "Log Agent",
    type: "Cron 定时",
    nextRun: "今天 21:00",
    status: "已暂停",
    statusClass:
      "bg-slate-100 text-slate-700 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/20",
  },
];

const capabilityStats = [
  { name: "Prometheus 分析", value: "2,416", icon: Brain },
  { name: "日志检索", value: "1,982", icon: Network },
  { name: "K8s 巡检", value: "1,224", icon: ShieldCheck },
  { name: "工具链执行", value: "9,842", icon: Wrench },
];

const agentHealth = [
  { name: "Infra Agent", state: "稳定", note: "成功率 99.2%" },
  { name: "Ops Copilot", state: "繁忙", note: "承载 12 个会话" },
  { name: "DB Agent", state: "关注", note: "最近 1 次失败" },
  { name: "Security Agent", state: "稳定", note: "风险检测正常" },
];

export function Dashboard() {
  useAuth();

  return (
    <div className="h-full overflow-y-auto dark:bg-slate-950">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-6 sm:px-6 xl:px-8">
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700/90 dark:bg-slate-900 dark:shadow-[0_10px_30px_-18px_rgba(0,0,0,0.65)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 dark:border-sky-700/70 dark:bg-sky-500/10 dark:text-sky-200">
                <Bot className="h-3.5 w-3.5" />
                控制台
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-2xl">
                  AI Agent 控制台
                </h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700/80 dark:bg-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-300">近 24 小时 Token</span>
                <span className="ml-3 text-sm font-semibold text-slate-950 dark:text-white">412K</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700/80 dark:bg-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-300">活跃 Agent</span>
                <span className="ml-3 text-sm font-semibold text-slate-950 dark:text-white">12</span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to="/chats"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:bg-sky-600 dark:hover:bg-sky-500 dark:focus-visible:ring-offset-slate-900"
            >
              进入智能会话
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/users"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
            >
              用户管理
            </Link>
          </div>
        </section>

        <section className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-12">
          {groupedMetrics.map((group) => {
            const Icon = group.icon;

            return (
              <article
                key={group.title}
                className="flex h-full flex-col rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-sm md:col-span-1 xl:col-span-3 dark:border-slate-700/90 dark:bg-slate-900 dark:shadow-[0_8px_24px_-18px_rgba(0,0,0,0.65)]"
              >
                <div className="flex min-h-[44px] items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-white">{group.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-300">{group.desc}</p>
                  </div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-900 dark:bg-slate-800/90 dark:text-slate-100">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>

                <div className="mt-4 grid auto-rows-fr grid-cols-2 gap-2.5">
                  {group.items.map((item) => (
                    <div
                      key={item.label}
                      className="flex min-h-[68px] flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-800"
                    >
                      <p className="text-xs text-slate-500 dark:text-slate-300">{item.label}</p>
                      <p className="mt-1 text-base font-semibold text-slate-950 dark:text-white">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </section>

        <section className="grid items-stretch gap-6 xl:grid-cols-12">
          <article className="flex h-full flex-col rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm xl:col-span-9 dark:border-slate-700/90 dark:bg-slate-900 dark:shadow-[0_10px_30px_-18px_rgba(0,0,0,0.65)]">
            <div className="border-b border-slate-200 pb-4 dark:border-slate-700/90">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-300">任务中心</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                核心任务列表
              </h2>
            </div>

            <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/90">
              <div className="relative w-full overflow-auto scrollbar-thin">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr className="border-b border-slate-200 dark:border-slate-700/90">
                      <th className="px-4 py-4 font-medium text-slate-500 dark:text-slate-300">任务</th>
                      <th className="px-4 py-4 font-medium text-slate-500 dark:text-slate-300">Agent</th>
                      <th className="px-4 py-4 font-medium text-slate-500 dark:text-slate-300">调度</th>
                      <th className="px-4 py-4 font-medium text-slate-500 dark:text-slate-300">执行</th>
                      <th className="px-4 py-4 font-medium text-slate-500 dark:text-slate-300">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskList.map((task) => (
                      <tr
                        key={task.name}
                        className="border-b border-slate-200 transition-colors hover:bg-slate-50 dark:border-slate-700/80 dark:hover:bg-slate-800"
                      >
                        <td className="px-4 py-4 font-medium text-slate-950 dark:text-white">
                          {task.name}
                        </td>
                        <td className="px-4 py-4 text-slate-600 dark:text-slate-200">{task.agent}</td>
                        <td className="px-4 py-4 text-slate-600 dark:text-slate-200">{task.type}</td>
                        <td className="px-4 py-4 text-slate-600 dark:text-slate-200">{task.nextRun}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${task.statusClass}`}>
                            {task.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </article>

          <div className="grid auto-rows-fr gap-6 xl:col-span-3">
            <article className="flex h-full flex-col rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700/90 dark:bg-slate-900 dark:shadow-[0_10px_30px_-18px_rgba(0,0,0,0.65)]">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-300">能力模块</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">技能摘要</h2>
              <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/90">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr className="border-b border-slate-200 dark:border-slate-700/90">
                      <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-300">技能</th>
                      <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-300">类型</th>
                      <th className="px-4 py-3 font-medium text-right text-slate-500 dark:text-slate-300">调用量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capabilityStats.map((item) => {
                      const Icon = item.icon;
                      return (
                        <tr
                          key={item.name}
                          className="border-b border-slate-200 last:border-b-0 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/70"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100">
                                <Icon className="h-4 w-4" />
                              </div>
                              <span className="font-medium text-slate-950 dark:text-white">{item.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-200">核心能力</td>
                          <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-200">{item.value}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="flex h-full flex-col rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700/90 dark:bg-slate-900 dark:shadow-[0_10px_30px_-18px_rgba(0,0,0,0.65)]">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-300">Agent 健康</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">运行状态</h2>
              <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/90">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr className="border-b border-slate-200 dark:border-slate-700/90">
                      <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-300">Agent</th>
                      <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-300">状态</th>
                      <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-300">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentHealth.map((item) => (
                      <tr
                        key={item.name}
                        className="border-b border-slate-200 last:border-b-0 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/70"
                      >
                        <td className="px-4 py-3 font-medium text-slate-950 dark:text-white">{item.name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-200">{item.state}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-200">{item.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}
