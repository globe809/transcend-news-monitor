# 🚀 部署指南：創見資訊新聞監控 → GitHub + Firebase Hosting

## 📁 專案結構

```
transcend-news-monitor/
├── public/
│   └── index.html          ← 主網頁（就是你的監控儀表板）
├── .github/
│   └── workflows/
│       └── deploy.yml      ← GitHub Actions 自動部署設定
├── firebase.json            ← Firebase Hosting 設定
├── .firebaserc              ← Firebase 專案 ID（需修改）
├── .gitignore
└── DEPLOY_GUIDE.md          ← 本文件
```

---

## 🔧 第一次設定（只需做一次）

### Step 1：建立 Firebase 專案

1. 開啟 [https://console.firebase.google.com](https://console.firebase.google.com)
2. 點「新增專案」→ 輸入名稱（例如：`transcend-news-monitor`）
3. 記下你的 **Project ID**（格式像 `transcend-news-monitor-abc12`）
4. 左側選單 → **Hosting** → 點「開始使用」→ 跳過 CLI 步驟直接到最後

### Step 2：修改 .firebaserc

打開 `.firebaserc`，把 `YOUR_FIREBASE_PROJECT_ID` 換成你的 Project ID：

```json
{
  "projects": {
    "default": "transcend-news-monitor-abc12"
  }
}
```

### Step 3：建立 GitHub Repo 並上傳

在終端機執行（把 `YOUR_USERNAME` 換成你的 GitHub 帳號）：

```bash
cd transcend-news-monitor

# 初始化 Git
git init
git add .
git commit -m "feat: 初次上傳 - 創見資訊新聞監控儀表板"

# 連接 GitHub（先在 GitHub 網站建立 repo，名稱：transcend-news-monitor）
git remote add origin https://github.com/YOUR_USERNAME/transcend-news-monitor.git
git branch -M main
git push -u origin main
```

### Step 4：取得 Firebase Service Account 金鑰

1. 開啟 [Google Cloud Console IAM](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. 選擇你的 Firebase 專案
3. 找到 `firebase-adminsdk-...@....iam.gserviceaccount.com` → 點選
4. 上方「金鑰」→「新增金鑰」→「JSON」→ 下載
5. 用文字編輯器打開這個 JSON 檔案，複製全部內容

### Step 5：設定 GitHub Secrets

1. 開啟你的 GitHub Repo → **Settings** → **Secrets and variables** → **Actions**
2. 點「New repository secret」，依序新增以下兩個：

| Secret 名稱 | 值 |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | 剛才複製的 JSON 完整內容 |
| `FIREBASE_PROJECT_ID` | 你的 Firebase Project ID |

---

## 🚀 日常使用（每次更新網頁）

之後只要修改 `public/index.html` 並執行：

```bash
git add public/index.html
git commit -m "update: 更新新聞監控功能"
git push
```

GitHub Actions 就會自動在 2-3 分鐘內部署到 Firebase！

你的網站網址會是：
```
https://YOUR_PROJECT_ID.web.app
```

---

## ✅ 確認部署成功

1. 前往 GitHub Repo → **Actions** 頁籤
2. 看到綠色勾勾 ✅ 表示部署成功
3. 直接開啟 `https://YOUR_PROJECT_ID.web.app` 即可看到儀表板

---

## 🔐 關於 Anthropic API Key 的安全建議

> ⚠️ **絕對不要把 API Key 寫進程式碼裡再 push 到 GitHub！**

目前程式的設計是讓使用者在瀏覽器畫面上輸入 API Key，每次輸入不會儲存，是相對安全的做法。

如果你之後想更進一步保護 Key，可以考慮：
- 加 Firebase Authentication（只讓特定人員登入）
- 改用 Firebase Cloud Functions 作為後端代理，讓 Key 存在伺服器端

---

## 💡 常見問題

**Q：部署後網頁顯示舊版本？**
A：按 Ctrl+Shift+R 強制重整，或等 CDN 快取更新（約 5 分鐘）。

**Q：GitHub Actions 失敗了怎麼辦？**
A：點進 Actions → 失敗的 job → 看紅色錯誤訊息，最常見是 Secret 沒設定好。

**Q：可以用自己的網域嗎？**
A：可以！Firebase Console → Hosting → 「新增自訂網域」，照步驟設定 DNS 即可。
