export interface Chat {
  jid: string;
  name: string;
  last_message_time: string;
  last_message: string;
  last_user_message: string;
  is_group: number;
  agent_type?: 'claude' | 'deepagent';
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

export interface JumpServerExecution {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  output?: string;
  started_at?: string;
  finished_at?: string;
  error_message?: string;
}

export interface JumpServerBlock {
  type: 'jumpserver_session';
  id?: string;
  stage:
    | 'connecting_jumpserver'
    | 'jumpserver_ready'
    | 'sending_target'
    | 'target_connecting'
    | 'target_connected'
    | 'running_remote_command'
    | 'completed'
    | 'error'
    | 'cancelled';
  status?: 'calling' | 'executed' | 'error' | 'cancelled';
  jumpserver_host?: string;
  target_host?: string;
  target_hint?: string;
  latest_output?: string;
  executions?: JumpServerExecution[];
  error_message?: string;
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
      status?: 'calling' | 'executed' | 'error' | 'cancelled';
      result?: string | object;
      [key: string]: unknown;
    }
  | {
      type: 'thinking' | 'redacted_thinking';
      text?: string;
      isComplete?: boolean;
      [key: string]: unknown;
    }
  | JumpServerBlock
  | PrometheusChartBlock;

export interface SlashCommand {
  command: string;
  description: string;
  allowedTools?: string[];
  source: 'sdk' | 'custom';
}

export interface SkillCatalogItem {
  name: string;
  has_skill_md: boolean;
  updated_at: string;
}

export interface SkillTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillTreeNode[];
  editable?: boolean;
}

export interface ChatSkillSelectionResponse {
  selectedSkills: string[];
  syncStatus: 'pending' | 'synced' | 'failed';
  lastSyncedAt: string | null;
  errorMessage: string | null;
}
