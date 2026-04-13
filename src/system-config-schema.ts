export type SystemConfigFieldType = 'text' | 'number' | 'toggle' | 'select' | 'secret';

const SYSTEM_CONFIG_SECTIONS = [
  { id: 'agent', title: 'Agent 基础' },
  { id: 'deepagent', title: 'DeepAgent' },
  { id: 'runtime', title: '运行时' },
  { id: 'security', title: '认证安全' },
  { id: 'knowledge-base', title: '知识库' },
  { id: 'summary-llm', title: '草稿总结 LLM' },
] as const;

export type SystemConfigSectionId = (typeof SYSTEM_CONFIG_SECTIONS)[number]['id'];

export interface SystemConfigSection {
  id: SystemConfigSectionId;
  title: string;
}

type SystemConfigFieldDefinition = {
  key: string;
  section: SystemConfigSectionId;
  label: string;
  type: SystemConfigFieldType;
  required: boolean;
  secret: boolean;
  restartRequired: boolean;
  defaultValue?: string;
  options?: Array<{ label: string; value: string }>;
  dangerLevel?: 'normal' | 'warning' | 'danger';
  dangerMessage?: string;
};

const SYSTEM_CONFIG_FIELDS = [
  {
    key: 'ASSISTANT_NAME',
    section: 'agent',
    label: '助手名称',
    type: 'text',
    required: true,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'ASSISTANT_HAS_OWN_NUMBER',
    section: 'agent',
    label: '助手独立号码',
    type: 'toggle',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'USE_LOCAL_AGENT',
    section: 'runtime',
    label: '使用本地 Agent',
    type: 'toggle',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'DEFAULT_AGENT_TYPE',
    section: 'agent',
    label: '默认 Agent 类型',
    type: 'select',
    required: true,
    secret: false,
    restartRequired: true,
    options: [
      { label: 'Claude', value: 'claude' },
      { label: 'Deep Agent', value: 'deepagent' },
    ],
  },
  {
    key: 'DEEP_AGENT_MODEL',
    section: 'deepagent',
    label: 'Deep Agent 模型',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'DEEP_AGENT_RUNNER_PATH',
    section: 'deepagent',
    label: 'Deep Agent Runner 路径',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'DEEP_AGENT_PYTHON',
    section: 'deepagent',
    label: 'Deep Agent Python 路径',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'CONTAINER_IMAGE',
    section: 'runtime',
    label: '容器镜像',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
    dangerLevel: 'warning',
  },
  {
    key: 'CONTAINER_TIMEOUT',
    section: 'runtime',
    label: '容器超时',
    type: 'number',
    required: true,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'CONTAINER_MAX_OUTPUT_SIZE',
    section: 'runtime',
    label: '容器输出大小上限',
    type: 'number',
    required: true,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'IDLE_TIMEOUT',
    section: 'runtime',
    label: '空闲超时',
    type: 'number',
    required: true,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'MAX_CONCURRENT_CONTAINERS',
    section: 'runtime',
    label: '最大并发容器数',
    type: 'number',
    required: true,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'TIMEZONE',
    section: 'runtime',
    label: '时区',
    type: 'text',
    required: true,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'JWT_SECRET',
    section: 'security',
    label: 'JWT 密钥',
    type: 'secret',
    required: true,
    secret: true,
    restartRequired: true,
    dangerLevel: 'danger',
    dangerMessage: '修改后会使现有登录 token 失效，需要重新登录。',
  },
  {
    key: 'JWT_EXPIRES_IN',
    section: 'security',
    label: 'JWT 过期时间',
    type: 'text',
    required: true,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_API_URL',
    section: 'knowledge-base',
    label: '知识库 API 地址',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_API_KEY',
    section: 'knowledge-base',
    label: '知识库 API Key',
    type: 'secret',
    required: false,
    secret: true,
    restartRequired: true,
  },
  {
    key: 'KB_API_ACCOUNT',
    section: 'knowledge-base',
    label: '知识库账号',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_API_USER',
    section: 'knowledge-base',
    label: '知识库用户',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_API_AGENT_ID',
    section: 'knowledge-base',
    label: '知识库 Agent ID',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_ROOT_URI',
    section: 'knowledge-base',
    label: '知识库根 URI',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_INJECT_LIMIT',
    section: 'knowledge-base',
    label: '知识库注入上限',
    type: 'number',
    required: true,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_SEARCH_TIMEOUT',
    section: 'knowledge-base',
    label: '知识库搜索超时',
    type: 'number',
    required: true,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_EXTRACT_TIMEOUT',
    section: 'knowledge-base',
    label: '知识库提取超时',
    type: 'number',
    required: true,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_SUMMARY_LLM_API_URL',
    section: 'summary-llm',
    label: '摘要 LLM API 地址',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_SUMMARY_LLM_API_KEY',
    section: 'summary-llm',
    label: '摘要 LLM API Key',
    type: 'secret',
    required: false,
    secret: true,
    restartRequired: true,
  },
  {
    key: 'KB_SUMMARY_LLM_MODEL',
    section: 'summary-llm',
    label: '摘要 LLM 模型',
    type: 'text',
    required: false,
    secret: false,
    restartRequired: true,
  },
  {
    key: 'KB_SUMMARY_LLM_TIMEOUT',
    section: 'summary-llm',
    label: '摘要 LLM 超时',
    type: 'number',
    required: true,
    secret: false,
    restartRequired: true,
  },
] as const satisfies readonly SystemConfigFieldDefinition[];

export type SystemConfigKey = (typeof SYSTEM_CONFIG_FIELDS)[number]['key'];

export interface SystemConfigField extends Omit<SystemConfigFieldDefinition, 'key' | 'section'> {
  key: SystemConfigKey;
  section: SystemConfigSectionId;
}

const SYSTEM_CONFIG_FIELD_MAP = new Map(
  SYSTEM_CONFIG_FIELDS.map((field) => [field.key, field] as const),
);

function cloneSystemConfigField(field: SystemConfigField): SystemConfigField {
  return {
    ...field,
    options: field.options?.map((option) => ({ ...option })),
  };
}

export function listSystemConfigFields(): SystemConfigField[] {
  return SYSTEM_CONFIG_FIELDS.map((field) => cloneSystemConfigField(field));
}

export function getSystemConfigField(key: string): SystemConfigField | undefined {
  const field = SYSTEM_CONFIG_FIELD_MAP.get(key as SystemConfigKey);
  return field ? cloneSystemConfigField(field) : undefined;
}

export function listSystemConfigSections(): SystemConfigSection[] {
  return SYSTEM_CONFIG_SECTIONS.map((section) => ({ ...section }));
}
