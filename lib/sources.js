'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 默认信息源（仓库根目录的 sources.json 优先）。
 * weight 表示编辑视角的信息密度（0-10），cat 是分类兜底。
 */
const DEFAULT_SOURCES = [
  // ── 中文科技 / 产品 ──────────────────────────────
  { id: '36kr',    name: '36氪',      url: 'https://www.36kr.com/feed',            weight: 9, cat: 'business', lang: 'zh' },
  { id: 'sspai',   name: '少数派',    url: 'https://sspai.com/feed',               weight: 9, cat: 'depth',    lang: 'zh' },
  { id: 'ifanr',   name: '爱范儿',    url: 'https://www.ifanr.com/feed',           weight: 8, cat: 'product',  lang: 'zh' },
  { id: 'geekpark',name: '极客公园',  url: 'https://www.geekpark.net/rss',         weight: 8, cat: 'product',  lang: 'zh' },
  { id: 'tmtpost', name: '钛媒体',    url: 'https://www.tmtpost.com/rss',          weight: 8, cat: 'business', lang: 'zh' },
  { id: 'leiphone',name: '雷峰网',    url: 'https://www.leiphone.com/feed',        weight: 8, cat: 'ai',       lang: 'zh' },
  { id: 'infoq',   name: 'InfoQ',     url: 'https://www.infoq.cn/feed',            weight: 8, cat: 'engineering', lang: 'zh' },
  { id: 'solidot', name: 'Solidot',   url: 'https://www.solidot.org/index.rss',    weight: 7, cat: 'science',  lang: 'zh' },
  { id: 'ithome',  name: 'IT 之家',   url: 'https://www.ithome.com/rss/',          weight: 6, cat: 'product',  lang: 'zh' },

  // ── 英文科技 / 深度 ──────────────────────────────
  { id: 'verge',   name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', weight: 8, cat: 'product', lang: 'en' },
  { id: 'mtr',     name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/', weight: 9, cat: 'depth', lang: 'en' },
  { id: 'ars',     name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', weight: 8, cat: 'engineering', lang: 'en' },
  { id: 'github',  name: 'GitHub Blog', url: 'https://github.blog/feed/',          weight: 7, cat: 'engineering', lang: 'en' }
];

function loadSources() {
  const file = path.join(__dirname, '..', 'sources.json');
  try {
    if (!fs.existsSync(file)) return DEFAULT_SOURCES;
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(list) || !list.length) return DEFAULT_SOURCES;
    return list
      .filter((s) => s && s.url)
      .map((s) => ({
        id: s.id || String(s.name || s.url).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 16),
        name: s.name || new URL(s.url).hostname.replace(/^www\./, ''),
        url: s.url,
        weight: Number(s.weight) || 7,
        cat: s.cat || null,
        lang: s.lang || 'zh'
      }));
  } catch (e) {
    console.warn('[sources] sources.json 读取失败，使用默认列表:', e.message);
    return DEFAULT_SOURCES;
  }
}

const SOURCES = loadSources();

const CATS = {
  ai:          'AI 与模型',
  product:     '产品与体验',
  business:    '商业与市场',
  depth:       '深度与观点',
  engineering: '工程与开源',
  science:     '科学与健康'
};

/** 分类关键词。命中越多，主题归属越明确。 */
const KEYWORDS = {
  ai: ['人工智能','大模型','智能体','模型','算法','训练','推理','算力','机器学习','深度学习','神经网络',
       'AI','AGI','LLM','GPT','ChatGPT','Claude','Gemini','OpenAI','Anthropic','DeepMind','Nvidia','英伟达',
       'Midjourney','Sora','Copilot','Agent','transformer','prompt','AIGC','多模态','具身智能','智驾','自动驾驶'],
  product: ['发布','上线','新品','评测','上手','体验','功能','更新','版本','设计','界面','交互','应用','App',
            'iPhone','苹果','华为','小米','荣耀','OPPO','vivo','三星','字节','腾讯','阿里','微信','抖音','小红书',
            '耳机','手机','电脑','平板','手表','硬件','芯片','操作系统','安卓','Android','iOS','鸿蒙','Vision Pro','折叠屏'],
  business: ['融资','财报','营收','利润','上市','IPO','股价','市值','收购','并购','投资','估值','市场','份额',
             '商业','公司','经济','消费','品牌','战略','裁员','降价','涨价','竞争','供应链','出海','关税','政策','监管',
             '亿元','亿美元','万元','增长','下滑','季度'],
  depth: ['深度','复盘','观察','思考','为什么','如何','背后','逻辑','趋势','未来','本质','方法','方法论','专栏',
          '长文','访谈','对话','我们','一代','十年','变迁','启示','反思','争议','困局','experiment','essay','why','how'],
  engineering: ['开源','GitHub','代码','程序员','开发者','开发','架构','数据库','编程','API','SDK','Rust','Python',
                'JavaScript','TypeScript','Go','部署','工程','重构','性能','系统设计','安全漏洞','漏洞','运维','云原生',
                'Kubernetes','Docker','编译器','框架','终端','Linux','命令行','SQL'],
  science: ['研究','科学','论文','实验','发现','生物','医学','基因','疫苗','太空','航天','气候','物理','数学','健康',
            '睡眠','大脑','癌症','病毒','能源','电池','核','nature','science','study','researchers']
};

module.exports = { SOURCES, CATS, KEYWORDS };
