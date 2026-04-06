/**
 * fetch-news.js  v2.0
 * 每天由 GitHub Actions 執行（台灣時間 08:00）
 * 抓取創見資訊、上游供應商、競品的最新新聞
 * 寫入 Firebase Firestore + 產生靜態 JSON 供網頁讀取
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── Firebase Admin ───────────────────────────────────────
let db = null;
try {
  const admin = require('firebase-admin');
  const sa    = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
  if (sa) {
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    db = admin.firestore();
    console.log('✅ Firebase Firestore 連線成功');
  } else {
    console.warn('⚠️  未設定 FIREBASE_SERVICE_ACCOUNT，跳過 Firestore 寫入');
  }
} catch (e) {
  console.warn('⚠️  Firebase 初始化失敗：', e.message);
}

// ─── 監控關鍵字分組 ──────────────────────────────────────
const KEYWORD_GROUPS = {
  '創見資訊': [
    '創見資訊', '2451 股票', 'Transcend 記憶體'
  ],
  '上游供應商': [
    'Samsung NAND Flash', 'Kioxia 記憶體', 'Micron NAND',
    'SanDisk NAND', 'Silicon Motion SMI', 'NAND Flash 報價'
  ],
  '競品': [
    'Kingston 記憶體', '威剛 ADATA', 'Silicon Power 記憶體',
    '宜鼎 Innodisk'
  ]
};

// ─── 情緒詞庫 ─────────────────────────────────────────────
const POS_KW = [
  '獲獎','得獎','榮獲','表揚','認證','通過','合格',
  '營收','成長','增長','創高','新高','突破','亮眼','強勁',
  '合作','策略聯盟','簽約','投資','擴大','佈局',
  '推出','上市','發表','創新','技術突破','領先',
  '獲利','盈餘','股利','配息','EPS','看好','穩健','樂觀'
];
const NEG_KW = [
  '虧損','虧蝕','下跌','衰退','下滑','萎縮',
  '召回','瑕疵','缺陷','故障','異常','事故',
  '訴訟','官司','罰款','制裁','調查',
  '裁員','資遣','停業','倒閉',
  '崩盤','大跌','暴跌','危機','風險',
  '負面','利空','看空','下修','降評'
];

function analyzeSentiment(text) {
  let pos = 0, neg = 0;
  POS_KW.forEach(k => { if (text.includes(k)) pos++; });
  NEG_KW.forEach(k => { if (text.includes(k)) neg++; });
  return pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
}

// ─── RSS 抓取 ─────────────────────────────────────────────
function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TranscendNewsBot/2.0)' },
      timeout: 15000
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseRSS(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const get = tag => {
      const cm = b.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
      if (cm) return cm[1].trim();
      const pm = b.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
      return pm ? pm[1].trim() : '';
    };
    const title       = get('title');
    const link        = get('link') || b.match(/<link\s*\/?>\s*([^\s<]+)/)?.[1] || '';
    const pubDate     = get('pubDate');
    const source      = get('source') || 'Google News';
    const description = get('description').replace(/<[^>]+>/g, '').slice(0, 250);
    if (title) items.push({ title, link, pubDate, source, description });
  }
  return items;
}

// ─── 工具 ─────────────────────────────────────────────────
function dedup(items) {
  const seen = new Set();
  return items.filter(n => {
    const k = n.title.trim().slice(0, 40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function getDocId(item) {
  return Buffer.from(item.title.slice(0, 80))
    .toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 50) || Date.now().toString();
}

function buildStats(news, groupBy = 'day') {
  const byCategory = {};
  for (const cat of Object.keys(KEYWORD_GROUPS)) {
    const c = news.filter(n => n.category === cat);
    byCategory[cat] = {
      total:    c.length,
      positive: c.filter(n => n.sentiment === 'positive').length,
      negative: c.filter(n => n.sentiment === 'negative').length,
      neutral:  c.filter(n => n.sentiment === 'neutral').length
    };
  }

  // 趨勢資料
  const trendMap = {};
  for (const item of news) {
    const d = new Date(item.pubDate);
    if (isNaN(d)) continue;
    const key = groupBy === 'month'
      ? d.toISOString().slice(0, 7)
      : d.toISOString().slice(0, 10);
    if (!trendMap[key]) trendMap[key] = { date: key, positive: 0, negative: 0, neutral: 0, total: 0 };
    trendMap[key][item.sentiment]++;
    trendMap[key].total++;
  }
  const trend = Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date));

  return {
    total:    news.length,
    positive: news.filter(n => n.sentiment === 'positive').length,
    negative: news.filter(n => n.sentiment === 'negative').length,
    neutral:  news.filter(n => n.sentiment === 'neutral').length,
    byCategory,
    trend
  };
}

function toTW(d) {
  return new Date(d.getTime() + 8 * 3600000)
    .toISOString().replace('T', ' ').slice(0, 16) + ' 台灣時間';
}

// ─── 主程式 ──────────────────────────────────────────────
async function main() {
  const now       = new Date();
  const dayAgo    = new Date(now - 1   * 86400000);
  const weekAgo   = new Date(now - 7   * 86400000);
  const monthAgo  = new Date(now - 30  * 86400000);
  const yearAgo   = new Date(now - 365 * 86400000);
  const nowTW     = toTW(now);

  console.log(`\n🚀 創見資訊新聞監控 v2.0`);
  console.log(`🕐 UTC: ${now.toISOString()}`);
  console.log(`🕗 台灣時間: ${nowTW}\n`);

  // ── 1. 抓取今日新聞 ──────────────────────────────────
  let todayNews = [];
  for (const [category, keywords] of Object.entries(KEYWORD_GROUPS)) {
    console.log(`\n📂 分類：${category}`);
    for (const keyword of keywords) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
      try {
        const xml   = await fetchURL(url);
        const items = parseRSS(xml);
        const fresh = items.filter(n => { const d = new Date(n.pubDate); return !isNaN(d) && d >= dayAgo; });
        const tagged = fresh.map(n => ({
          ...n,
          category,
          sentiment: analyzeSentiment(n.title + ' ' + n.description),
          fetchedAt: now.toISOString()
        }));
        todayNews.push(...tagged);
        console.log(`  ✅ "${keyword}": ${tagged.length} 則`);
      } catch (e) {
        console.error(`  ❌ "${keyword}": ${e.message}`);
      }
    }
  }

  todayNews = dedup(todayNews).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  console.log(`\n📰 今日合計 ${todayNews.length} 則（去重後）`);

  // ── 2. 寫入 Firestore ────────────────────────────────
  if (db && todayNews.length > 0) {
    try {
      let batch = db.batch();
      let cnt   = 0;
      const commits = [];
      for (const item of todayNews) {
        batch.set(db.collection('news').doc(getDocId(item)), item, { merge: true });
        if (++cnt % 400 === 0) { commits.push(batch.commit()); batch = db.batch(); }
      }
      commits.push(batch.commit());
      await Promise.all(commits);
      console.log(`✅ Firestore 寫入 ${todayNews.length} 則`);
    } catch (e) {
      console.error('❌ Firestore 寫入失敗：', e.message);
    }
  }

  // ── 3. 從 Firestore 讀取歷史資料 ────────────────────
  let weekNews = todayNews, monthNews = todayNews, yearNews = todayNews;

  if (db) {
    try {
      const snap = await db.collection('news')
        .where('fetchedAt', '>=', yearAgo.toISOString())
        .get();
      const all = snap.docs.map(d => d.data());
      weekNews  = dedup(all.filter(n => new Date(n.fetchedAt) >= weekAgo))
                   .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
      monthNews = dedup(all.filter(n => new Date(n.fetchedAt) >= monthAgo))
                   .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
      yearNews  = dedup(all).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
      console.log(`📚 Firestore：週 ${weekNews.length} / 月 ${monthNews.length} / 年 ${yearNews.length}`);
    } catch (e) {
      console.error('❌ Firestore 讀取失敗：', e.message, '（將使用今日資料代替）');
    }
  }

  // ── 4. 產生 JSON 檔案 ────────────────────────────────
  const pub = path.join(__dirname, '..', 'public');

  const write = (filename, data) => {
    fs.writeFileSync(path.join(pub, filename), JSON.stringify(data, null, 2), 'utf8');
    const kb = Math.round(JSON.stringify(data).length / 1024);
    console.log(`  📄 ${filename} (${kb} KB)`);
  };

  console.log('\n💾 產生 JSON 檔案：');

  write('news-today.json', {
    period: 'today', generatedAt: now.toISOString(), generatedAtTW: nowTW,
    stats: buildStats(todayNews, 'day'),
    news: todayNews
  });

  write('news-week.json', {
    period: 'week', generatedAt: now.toISOString(), generatedAtTW: nowTW,
    stats: buildStats(weekNews, 'day'),
    news: weekNews.slice(0, 500)
  });

  write('news-month.json', {
    period: 'month', generatedAt: now.toISOString(), generatedAtTW: nowTW,
    stats: buildStats(monthNews, 'day'),
    news: monthNews.slice(0, 300)
  });

  write('news-year.json', {
    period: 'year', generatedAt: now.toISOString(), generatedAtTW: nowTW,
    stats: buildStats(yearNews, 'month'),
    news: yearNews.slice(0, 100)
  });

  // 向下相容舊版
  write('news-data.json', {
    fetchedAt: now.toISOString(), fetchedAtTW: nowTW,
    stats: buildStats(todayNews, 'day'),
    news: todayNews
  });

  console.log('\n🎉 完成！');
}

main().catch(err => { console.error('❌ 執行失敗：', err); process.exit(1); });
