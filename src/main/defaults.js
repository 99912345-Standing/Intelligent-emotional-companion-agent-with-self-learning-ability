export const APP_NAME = '伴行';
export const APP_VERSION = '1.0.0';

export const DEFAULT_CONFIG = {
  version: 1,
  app: {
    name: '伴行',
    subtitle: '陪伴工作型 Agent',
    checkOnStart: true,
    closeToTray: false,
    firstRun: true
  },
  models: {
    primary: {
      label: '主模型',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      temperature: 0.7,
      maxTokens: 3000,
      contextWindow: 64000,
      capabilities: { text: false, vision: false, tools: false, checkedAt: null },
      timeoutMs: 120000
    },
    helper: {
      enabled: false,
      label: '多模态问答模型',
      protocol: 'openai',
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.3,
      maxTokens: 1600,
      capabilities: { text: false, vision: false, tools: false, checkedAt: null },
      timeoutMs: 90000
    }
  },
  persona: {
    name: '伴行',
    relationship: '长期同行的伙伴',
    userTitle: '你',
    workStyle: '清晰、可靠、先给结论，再给可执行步骤；遇到风险直接说明。',
    companionStyle: '温和、有分寸地接住情绪，不敷衍、不说教，也不假装是人类。',
    boundaries: '不泄露密钥与隐私；不擅自进行删除、付款、对外发送等高风险操作；能力不足时明确说明。',
    aiMinEvidence: 3,
    aiMinSpanDays: 0,
    aiCooldownHours: 0,
    aiEmotionalCooldownHours: 0,
    aiMaxRevisions7d: 3,
    aiLocked: false,
    autoEvolve: true,
    autoEvolveEvery: 24
  },
  weights: {
    initial: { work: 0.33, companion: 0.34, learning: 0.33 },
    baseline: { work: 0.3, companion: 0.4, learning: 0.3 },
    halfLifeMinutes: { work: 20, companion: 90, learning: 45 },
    highThreshold: 0.7,
    otherBaseline: 0.3,
    eventMargin: 0.05,
    eventCooldownSec: 30,
    reverseConfidenceThreshold: 0.75,
    worklogTransferMinutes: 300,
    reflectEvery: 12,
    aiTuneCooldownSec: 20,
    aiTuneMaxDelta: 0.06
  },
  agent: {
    maxReplyChars: 900,
    detailedReplyChars: 1800,
    qqMaxReplyChars: 520,
    qqDetailedReplyChars: 900,
    qqMaxSentences: 3,
    chatTemperature: 0.87,
    minimalAfterTurns: 10,
    minimalReplyChance: 0.2,
    autoDiaryHours: 6,
    autoDiaryMinTurns: 6,
    followUpEnabled: true,
    followUpChance: 0.3
  },
  multimodal: {
    enabled: true,
    slots: [
      { id: 'vision', label: '识图 / 画面理解', role: 'helper', description: '描述图片、界面、物体与场景', protocol: 'openai', baseUrl: '', apiKey: '', model: '' },
      { id: 'ocr', label: 'OCR / 读字', role: 'helper', description: '提取截图和图片中的文字', protocol: 'openai', baseUrl: '', apiKey: '', model: '' },
      { id: 'audio', label: '语音转写', role: 'helper', description: '语音、录音的转写插槽（需支持音频的模型）', protocol: 'openai', baseUrl: '', apiKey: '', model: '' },
      { id: 'document', label: '文档 / 网页解析', role: 'primary', description: 'PDF、网页、长文的结构化阅读', protocol: 'openai', baseUrl: '', apiKey: '', model: '' },
      { id: 'imagegen', label: '图像生成', role: 'helper', description: '生成图片或表情的插槽（需支持图像输出的模型）', protocol: 'openai', baseUrl: '', apiKey: '', model: '' }
    ]
  },
  autonomy: {
    enabled: true,
    usePhone: true,
    useComputer: false,
    allowAppDownload: false,
    minIdleMinutes: 60,
    checkIntervalMinutes: 5,
    cooldownMinutes: 180,
    maxMinutes: 10,
    maxSteps: 8
  },
  idleLearning: {
    enabled: true,
    minIdleMinutes: 60,
    checkIntervalMinutes: 5,
    cooldownMinutes: 180,
    maxPerDay: 4,
    quietStart: 0,
    quietEnd: 7,
    freeTopics: true,
    topics: [
      '近期有哪些值得了解的科学发现',
      '人类如何建立信任与长期关系',
      '高效学习与记忆保持的方法',
      'AI 工具正在改变哪些知识工作',
      '艺术、音乐与人的情绪调节',
      '城市生活如何影响人的心理状态',
      '人为什么会感到孤独',
      '睡眠、注意力与日常效率'
    ]
  },
  memory: {
    worklogIdleMinutes: 300,
    autoResearch: true,
    autoArchive: true,
    knowledgeConfidenceThreshold: 0.34,
    relationshipBoost: 1.65,
    maxContextEntries: 14,
    staleAfterDays: 90,
    chatHistoryTurns: 18
  },
  search: {
    provider: 'bing',
    providers: ['bing', 'duckduckgo', 'wikipedia'],
    searxngUrl: '',
    maxResults: 6,
    fetchTop: 4,
    maxPageChars: 6000,
    timeoutMs: 18000,
    minSources: 2,
    archiveConfidence: 0.58,
    browserCrawler: true,
    browserPath: '',
    allowVideoDownload: true,
    maxVideoMb: 80
  },
  qq: {
    enabled: false,
    autoConnect: false,
    onebotMode: 'auto',
    wsUrl: 'ws://127.0.0.1:3001',
    httpUrl: 'http://127.0.0.1:3000',
    accessToken: '',
    wsToken: '',
    httpToken: '',
    primaryConversation: false,
    homeDir: '',
    launcherPath: '',
    autoStartSnowLuma: false,
    webuiUrl: 'http://127.0.0.1:5099',
    ownerQQ: '',
    allowPrivate: [],
    allowGroups: [],
    denyPrivate: [],
    denyGroups: [],
    allowAllWhenEmpty: false,
    autoReply: true,
    requireAtInGroup: true,
    groupActivityMode: 'manual',
    groupActivity: 15,
    groupCooldownSec: 30,
    privateActivityMode: 'manual',
    privateActivity: 0,
    privateIdleMinutes: 180,
    privateMinIntervalMinutes: 120,
    proactiveUseResearch: true,
    proactiveUsePhone: false,
    replyToGroups: false,
    maxReplyChars: 900,
    sendDelayMs: 500,
    batchWindowMs: 900,
    stickerUseFrequency: 35,
    stickerReplyChance: 35,
    quoteReplies: true,
    humanize: {
      enabled: true,
      perCharMs: 32,
      minDelayMs: 1500,
      maxDelayMs: 4500,
      maxChunks: 3,
      gapMinMs: 650,
      gapMaxMs: 2400,
      quietStart: 23,
      quietEnd: 8,
      quietFactor: 1.35
    },
    proactiveQuietStart: 0,
    proactiveQuietEnd: 7,
    ackMessage: '',
    healthWarnMs: 600000
  },
  phone: {
    mode: 'auto',
    serial: '',
    adbPath: '',
    autoScanEmulators: true,
    emulatorPort: 5554,
    screenshotMaxWidth: 1280,
    autoDescribe: false,
    permissions: {
      control: true,
      shell: false,
      installApk: false
    }
  },
  computer: {
    enabled: false,
    allowShell: false,
    screenshotScale: 1,
    permissions: {
      mouse: true,
      keyboard: true,
      appLaunch: true,
      shell: false
    }
  },
  permissions: {
    webSearch: true,
    qqSend: true,
    qqDynamic: true,
    phoneControl: true,
    computerControl: false,
    mcpServers: true,
    music: true,
    fileRead: true,
    fileWrite: true,
    dangerousShell: false
  },
  music: {
    cdpPort: 9222,
    cloudMusicPath: '',
    ttsVoice: '',
    voice: {
      engine: 'sapi',
      rvcEnabled: false,
      pythonPath: '',
      repoPath: '',
      modelPath: '',
      indexPath: '',
      pitch: 0
    }
  },
  mcp: {
    servers: [],
    startupTimeoutMs: 25000
  },
  plugins: {
    enabled: ['hermes'],
    disabled: [],
    allowUnverified: false
  },
  security: {
    localOnly: true,
    maskKeysInUi: true,
    requireComputerConfirmation: true
  },
  ui: {
    theme: 'warm',
    compact: false,
    lastRoute: 'home'
  }
};

export const DEFAULT_PLUGIN_MANIFEST = {
  id: '',
  name: '',
  version: '0.0.0',
  description: '',
  entry: 'index.js',
  permissions: [],
  builtin: false
};
