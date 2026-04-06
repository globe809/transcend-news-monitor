/**
 * fetch-news.js
 * 每天由 GitHub Actions 執行，抓取最近 24 小時的創見資訊相關新聞
 * 並儲存至 public/news-data.json 供網頁直接讀取
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── 設定 ───────────────────────────────────────────────
const KEYWORDS = ['創見資訊', '創見', '2451'];

const POSITIVE_KW = [
  '獲獎','得獎','榮獲','表揚','優良','認證','認可','合格','通過',
  '營收','成長','增長','創高','新高','突破','達成','超越','亮眼',
  '合作','策略聯盟','夥伴','簽約','合約','投資','擴大','佈局',
  '發布','推出','上市','發表','創新','技術突破','領先',
  '獲利','盈餘','股利','配息','EPS','業績',
  '正面','利好','樂觀','信心','強勁','穩健','看好'
];

const NEGATIVE_KW = [
  '虧損','虧蝕','跌','下跌','衰退','下滑','萎縮',
  '召回','瑕疵','缺陷','問題','故障','異常','事故','意外',
  '訴訟','官司','起訴','判決','罰款','制裁','調查','稽查',
  '裁員','資遣','停業','倒閉','退出',
  '崩盤','大跌','暴跌','崩潰','危機','風險','壓力',
  '負面','利空','看空','下修','降評','調降'
];

// ─── 工具函式 ────────────────────────────────────────────
function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      },
      timeout: 15000
    }, (res) => {
      // 處理重新導向
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const get = (tag) => {
      const cdataMatch = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
      if (cdataMatch) return cdataMatch[1].trim();
      const plainMatch = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
      return plainMatch ? plainMatch[1].trim() : '';
    };

    const title       = get('title');
    const link        = get('link') || block.match(/<link\s*\/?>([^<]+)/)?.[1]?.trim() || '';
    const pubDate     = get('pubDate');
    const source      = get('source') || 'Google News';
    const description = get('description').replace(/<[^>]+>/g, '').slice(0, 300);

    if (title) items.push({ title, link, pubDate, source, description });
  }

  return items;
}

function analyzeSentiment(text) {
  const t = text;
  let pos = 0, neg = 0;
  POSITIVE_KW.forEach(kw => { if (t.includes(kw)) pos++; });
  NEGATIVE_KW.forEach(kw => { if (t.includes(kw)) neg++; });
  if (pos === 0 && neg === 0) return 'neutral';
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

// ─── 主程式 ──────────────────────────────────────────────
async function main() {
  const now        = new Date();
  const oneDayAgo  = new Date(now - 24 * 60 * 60 * 1000);

  console.log(`🕐 開始抓取新聞 (UTC: ${now.toISOString()})`);
  console.log(`📅 篩選範圍：最近 24 小時 (${oneDayAgo.toISOString()} 之後)`);

  let allItems = [];

  for (const keyword of KEYWORDS) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    try {
      console.log(`🔍 抓取關鍵字：「${keyword}」`);
      const xml   = await fetchURL(url);
      const items = parseRSS(xml);
      console.log(`   ✅ 取得 ${items.length} 則`);
      allItems.push(...items);
    } catch (e) {
      console.error(`   ❌ 失敗：${e.message}`);
    }
  }

  // 去重（依標題前 40 字）
  const seen = new Set();
  allItems = allItems.filter(item => {
    const key = item.title.trim().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 篩選最近 24 小時
  const filtered = allItems.filter(item => {
    const d = new Date(item.pubDate);
    return !isNaN(d) && d >= oneDayAgo;
  });

  console.log(`📰 去重後共 ${allItems.length} 則，其中 24 小時內 ${filtered.length} 則`);

  // 加入情緒分析
  const news = filtered.map(item => ({
    ...item,
    sentiment: analyzeSentiment(item.title + ' ' + item.description)
  }));

  // 依時間排序（新的在前）
  news.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // 統計
  const stats = {
    total:    news.length,
    positive: news.filter(n => n.sentiment === 'positive').length,
    negative: news.filter(n => n.sentiment === 'negative').length,
    neutral:  news.filter(n => n.sentiment === 'neutral').length
  };

  const output = {
    fetchedAt:  now.toISOString(),
    // 台灣時間標記（UTC+8）
    fetchedAtTW: new Date(now.getTime() + 8 * 60 * 60 * 1000)
                   .toISOString().replace('T', ' ').slice(0, 16) + ' (台灣時間)',
    stats,
    news
  };

  const outPath = path.join(__dirname, '..', 'public', 'news-data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`✅ 儲存完成：${outPath}`);
  console.log(`📊 統計：正面 ${stats.positive} / 負面 ${stats.negative} / 中性 ${stats.neutral}`);
}

main().catch(err => {
  console.error('❌ 執行失敗：', err);
  process.exit(1);
});
