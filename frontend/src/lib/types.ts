export interface Chat {
  jid: string;
  name: string;
  last_message_time: string;
  last_message: string;
  last_user_message: string;
  is_group: number;
}

export interface Message {
  id: string;
  chat_jid: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message: boolean;
}

export interface PrometheusChartBlock {
  type: 'prometheus_chart';
  title: string;
  unit: string;
  timeRange: string;
  datasource?: string;
  series: Array<{
    instance: string;
    data: Array<[number, number]>;
  }>;
  [key: string]: unknown;
}

export type ContentBlock =
  | { type: 'text'; text?: string; [key: string]: unknown }
  | {
      type: 'tool_use';
      id?: string;
      name?: string;
      input?: unknown;
      partial_json?: string;
      status?: 'calling' | 'executed' | 'error';
      result?: string | object;
      [key: string]: unknown;
    }
  | { type: 'thinking' | 'redacted_thinking'; text?: string; [key: string]: unknown }
  | PrometheusChartBlock;

export interface SlashCommand {
  command: string;
  description: string;
  allowedTools?: string[];
  source: 'sdk' | 'custom';
}
