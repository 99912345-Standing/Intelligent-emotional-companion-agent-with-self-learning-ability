// 内容边界：知识学习不接触政治、色情、暴力等内容；情感材料只收人类情感/关系主题。
const POLITICAL = /(政治|政党|选举|大选|政府|领导人|主席|总统|首相|议会|抗议|游行|示威|政变|意识形态|中共|共产党|国民党|民进党|台独|港独|疆独|藏独|法轮|六四|政治立场|乌克兰战争|巴以冲突|以色列|巴勒斯坦|美国大选|国会山)/i;
const ADULT = /(色情|成人内容|裸体|裸照|性爱|性行为|约炮|黄片| pornography|porn|nsfw|onlyfans|hentai)/i;
const VIOLENCE = /(血腥|暴力|虐杀|杀人|凶杀|恐怖袭击|枪击|爆炸|自残|自杀|肢解|酷刑|gore|massacre|shooting)/i;
const MEDICAL_HIGH_RISK = /(诊断|处方|剂量|用药|自杀方法|怎么自杀|制作炸弹|制毒)/i;

const HUMAN_EMOTION = /(人类|人的|情感|情绪|依恋|亲密|孤独|信任|共情|同理心|爱|失恋|思念|告别|和解|友谊|家庭|亲子|陪伴|沟通|心理|安全感|边界感|关系|安慰|悲伤|哀悼|失去|幸福|快乐|愤怒|恐惧|羞耻|内疚|嫉妒|恋爱|分手|婚姻|社交|倾听|表达|创伤|疗愈|自我|身份|意义)/i;
const TECHNICAL = /(AI|人工智能|模型|算法|系统|代码|编程|数据库|框架|API|工具调用|长期记忆|知识库|向量|检索|提示词|agent|llm)/i;

export function unsafeReason(text) {
  const value = String(text || '');
  if (!value) return '';
  if (POLITICAL.test(value)) return '政治敏感';
  if (ADULT.test(value)) return '色情/成人内容';
  if (VIOLENCE.test(value)) return '暴力/血腥内容';
  if (MEDICAL_HIGH_RISK.test(value)) return '高风险医疗/伤害内容';
  return '';
}

export function isSafeContent(text) {
  return !unsafeReason(text);
}

export function isEmotionalTopic(text) {
  const value = String(text || '');
  if (!value || unsafeReason(value)) return false;
  const emotionHits = (value.match(HUMAN_EMOTION) || []).length;
  const humanSubject = /(人类|人的|人为什么|人如何|一个人|我们为什么|人们|人际|关系|情绪|情感|心理)/i.test(value);
  const technical = TECHNICAL.test(value);
  // “AI 陪伴中的情感记忆研究”属于技术知识，不应写成用户的情感记忆。
  return (emotionHits >= 2 || (humanSubject && emotionHits >= 1)) && !technical;
}

export function isEmotionalEvidence(text) {
  const value = String(text || '');
  if (!value || unsafeReason(value)) return false;
  return isEmotionalTopic(value) && /(研究发现|研究表明|人们|人类|关系|情绪|依恋|信任|孤独|陪伴|沟通|心理)/i.test(value);
}

const SAFE_SCOPE = /(科学|技术|AI|人工智能|计算|自然|宇宙|物理|化学|数学|天文|地理|地质|进化|基因|脑|意识|生物|环境|生态|心理|情感|情绪|关系|教育|学习|知识|工作|效率|艺术|音乐|文学|电影|游戏|设计|哲学|文化|语言|历史|动物|植物|猫|狗|宠物|食物|饮品|咖啡|茶|运动|旅行|睡眠|习惯|生活|身体|感官|颜色|声音|材料|能源|城市|交通|建筑|摄影|手工|健身|互联网|软件|硬件|编程|人|社会现象|创造力|记忆|认知|工具|模型)/i;
const QUESTION_FORM = /(为什么|为何|如何|怎么|是什么|有哪些|有没有|能否|会不会|该不该|哪种|哪些|是否|原理|方法|区别|影响|作用|趋势|起源|历史|科学|研究)/i;
const PRIVACY = /(qq|微信|电话|手机号|住址|地址|身份证|邮箱|@|\b\d{5,}\b)/i;
const VAGUE = /^(这个|那个|东西|事情|随便|什么|怎么|为什么|聊聊|看看|了解一下|有意思|奇怪|不知道)[。！？!?\s]*$/i;

export function reviewIdleQuery(query) {
  const text = String(query || '').replace(/\s+/g, ' ').trim();
  const highRiskReason = unsafeReason(text);
  const privacy = PRIVACY.test(text);
  const safeScope = SAFE_SCOPE.test(text) || QUESTION_FORM.test(text);
  const repeated = /(.)\1{5,}/.test(text);
  const hasLanguage = /[\u3400-\u9fffA-Za-z]{3,}/.test(text);
  const quality = text.length >= 6 && text.length <= 220 && hasLanguage && !repeated && !VAGUE.test(text) && !/^[?？!！。.\s]+$/.test(text);
  const passed = !highRiskReason && !privacy && safeScope && quality;
  return {
    query: text,
    safeScope,
    privacy: !privacy,
    highRisk: !highRiskReason,
    quality,
    passed,
    reason: highRiskReason || (privacy ? '包含隐私信息' : !safeScope ? '不在安全主题范围' : !quality ? '空泛或古怪主题' : '')
  };
}
