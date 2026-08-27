const $ = (id) => document.getElementById(id);

const captureInput = $("captureInput");
const albumInput = $("albumInput");
const frame = $("frame");
const statusBox = $("status");
const statusText = $("statusText");
const errorBox = $("errorBox");
const results = $("results");
const preview = $("preview");
const ocrTextEl = $("ocrText");
const jpTextEl = $("jpText");
const transHeading = $("transHeading");
const furiganaEl = $("furigana");
const romajiEl = $("romaji");
const speakBtn = $("speakBtn");
const speakBar = $("speakBar");
const speakBarBtn = $("speakBarBtn");
const installHint = $("installHint");

const MAX_EDGE = 1600;
const GOOGLE_TL = "https://clients5.google.com/translate_a/t";
const MYMEMORY = "https://api.mymemory.translated.net/get";
const TESSERACT_SRC = "https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js";
const WANAKANA_SRC = "https://unpkg.com/wanakana@5.3.1/wanakana.min.js";
const KUROSHIRO_SRC = "https://unpkg.com/kuroshiro@1.2.0/dist/kuroshiro.min.js";
const KURO_ANALYZER_SRC = "https://unpkg.com/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js";
const KUROMOJI_DICT = "https://unpkg.com/kuromoji@0.1.2/dict/";
const SCRIPT_TIMEOUT_MS = 20000;
const OCR_INIT_TIMEOUT_MS = 120000;
const OCR_RUN_TIMEOUT_MS = 60000;
const TRANSLATE_TIMEOUT_MS = 15000;
const KURO_WAIT_MS = 22000;

const JP_READINGS = {
  "アレルギー物質": "あれるぎーぶっしつ",
  "特定原材料": "とくていげんざいりょう",
  "それに準ずるもの": "それにじゅんずるもの",
  "使用していません": "しようしていません",
  "使用上の注意": "しようじょうのちゅうい",
  "お召し上がりください": "おめしあがりください",
  "お召し上がり": "おめしあがり",
  "召し上がり": "めしあがり",
  "直射日光": "ちょくしゃにっこう",
  "高温多湿": "こうおんたしつ",
  "賞味期限": "しょうみきげん",
  "消費期限": "しょうひきげん",
  "株式会社": "かぶしきがいしゃ",
  "保存方法": "ほぞんほうほう",
  "製造者": "せいぞうしゃ",
  "内容量": "ないようりょう",
  "龍角散": "りゅうかくさん",
  "原材料": "げんざいりょう",
  "酸味料": "さんみりょう",
  "着色料": "ちゃくしょくりょう",
  "開封後": "かいふうご",
  "東京都": "とうきょうと",
  "千代田": "ちよだ",
  "欄外": "らんがい",
  "記載": "きさい",
  "開封": "かいふう",
  "早め": "はやめ",
  "香料": "こうりょう",
  "物質": "ぶっしつ",
  "使用": "しよう",
  "製造": "せいぞう",
  "保存": "ほぞん",
  "方法": "ほうほう",
  "避け": "さけ",
  "準ずる": "じゅんずる",
  "注意": "ちゅうい",
  "定食": "ていしょく",
  "朝食": "ちょうしょく",
  "昼食": "ちゅうしょく",
  "夕食": "ゆうしょく",
  "弁当": "べんとう",
  "焼肉": "やきにく",
  "刺身": "さしみ",
  "寿司": "すし",
  "餃子": "ぎょうざ",
  "唐揚げ": "からあげ",
  "天ぷら": "てんぷら",
  "味噌汁": "みそしる",
  "会計": "かいけい",
  "注文": "ちゅうもん",
  "営業": "えいぎょう",
  "時間": "じかん",
  "本日": "ほんじつ",
  "休業": "きゅうぎょう",
  "入口": "いりぐち",
  "出口": "でぐち",
  "案内": "あんない",
  "ご飯": "ごはん",
  "お茶": "おちゃ",
  "お水": "おみず"
};

let jobId = 0;
let jobChain = Promise.resolve();
let ocrWorker = null;
let kuroReady = null;
let lastSpoken = "";

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || "timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function showStatus(msg) {
  statusText.textContent = msg;
  statusBox.hidden = false;
}

function hideStatus() {
  statusBox.hidden = true;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = !msg;
}

function hasKana(text) {
  return /[\u3040-\u30ff]/.test(text);
}

function hasHan(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function cleanOcr(text) {
  return (text || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function chunkText(text, size) {
  if (text.length <= size) return [text];
  const parts = [];
  let rest = text;
  while (rest.length) {
    if (rest.length <= size) {
      parts.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n", size);
    if (cut < 40) cut = rest.lastIndexOf("。", size);
    if (cut < 40) cut = rest.lastIndexOf(".", size);
    if (cut < 40) cut = rest.lastIndexOf("，", size);
    if (cut < 40) cut = size;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return parts.filter(Boolean);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const found = document.querySelector('script[src="' + src + '"]');
    if (found) {
      if (found.getAttribute("data-loaded") === "1") return resolve();
      found.addEventListener("load", () => resolve());
      found.addEventListener("error", () => reject(new Error("load failed: " + src)));
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => {
      el.setAttribute("data-loaded", "1");
      resolve();
    };
    el.onerror = () => reject(new Error("load failed: " + src));
    document.head.appendChild(el);
  });
}

function setSafeRuby(el, html) {
  const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  const wrap = doc.body.firstElementChild;
  const keep = new Set(["RUBY", "RB", "RT", "RP", "SPAN"]);
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 1 && !keep.has(child.tagName)) {
        child.replaceWith(doc.createTextNode(child.textContent || ""));
      } else if (child.nodeType === 1) {
        [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
        walk(child);
      }
    });
  };
  if (wrap) {
    walk(wrap);
    el.replaceChildren(...wrap.childNodes);
  } else {
    el.textContent = html;
  }
}

function resizeToCanvas(source) {
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  if (!w || !h) throw new Error("empty-frame");
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  frame.width = Math.round(w * scale);
  frame.height = Math.round(h * scale);
  frame.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0, frame.width, frame.height);
  return frame;
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image-load-failed"));
    };
    img.src = url;
  });
}

async function fileToSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (err) {
      console.warn("createImageBitmap failed", err);
    }
  }
  return fileToImage(file);
}

async function ensureOcr(alive) {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) {
    if (!alive()) return null;
    showStatus("載入辨識引擎…");
    await withTimeout(loadScript(TESSERACT_SRC), SCRIPT_TIMEOUT_MS, "engine-load-timeout");
  }
  const logger = (m) => {
    if (!alive() || !m || !m.status) return;
    if (m.status === "loading tesseract core") showStatus("載入辨識核心…");
    else if (m.status === "loading language traineddata") showStatus("載入字庫（第一次較久）…");
    else if (m.status === "initializing tesseract") showStatus("初始化辨識引擎…");
    else if (m.status === "recognizing text") {
      const pct = typeof m.progress === "number" ? Math.round(m.progress * 100) : 0;
      showStatus("辨識中 " + pct + "%");
    }
  };
  const attempts = ["jpn+chi_tra", "jpn"];
  let lastErr;
  for (const langs of attempts) {
    if (!alive()) return null;
    try {
      showStatus("載入字庫 " + langs + "…");
      ocrWorker = await withTimeout(
        Tesseract.createWorker(langs, 1, { logger }),
        OCR_INIT_TIMEOUT_MS,
        "ocr-init-timeout"
      );
      return ocrWorker;
    } catch (err) {
      lastErr = err;
      if (ocrWorker) {
        try { await ocrWorker.terminate(); } catch (e) {}
        ocrWorker = null;
      }
    }
  }
  throw lastErr || new Error("ocr-init-failed");
}

async function runOcr(alive) {
  const worker = await ensureOcr(alive);
  if (!worker || !alive()) return "";
  showStatus("辨識中…");
  const { data } = await withTimeout(worker.recognize(frame), OCR_RUN_TIMEOUT_MS, "ocr-timeout");
  return cleanOcr(data && data.text);
}

function detectDirection(text) {
  if (hasKana(text)) return { sl: "ja", tl: "zh-TW", pair: "ja|zh-TW", target: "zh", heading: "中文翻譯" };
  if (/[A-Za-z]{4,}/.test(text) && !hasHan(text)) return { sl: "en", tl: "ja", pair: "en|ja", target: "ja", heading: "日文翻譯" };
  return { sl: "zh-TW", tl: "ja", pair: "zh-TW|ja", target: "ja", heading: "日文翻譯" };
}

function isBadTranslation(text) {
  if (!text) return true;
  return /MYMEMORY WARNING|YOU USED ALL AVAILABLE|QUERY LENGTH|INVALID LANGUAGE|PLEASE SELECT TWO|<html|We're sorry|automated queries/i.test(text);
}

function parseGoogleTranslation(data) {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.charAt(0) === "[" || trimmed.charAt(0) === "{") {
      try { return parseGoogleTranslation(JSON.parse(trimmed)); } catch (err) { return trimmed; }
    }
    return trimmed;
  }
  if (Array.isArray(data)) {
    if (typeof data[0] === "string") return data[0];
    if (Array.isArray(data[0])) {
      return data[0].map((row) => (Array.isArray(row) ? row[0] : row)).join("");
    }
  }
  if (data && typeof data === "object") {
    if (typeof data.translatedText === "string") return data.translatedText;
    if (Array.isArray(data.sentences)) return data.sentences.map((s) => s.trans || "").join("");
  }
  return "";
}

async function translateGoogle(text, sl, tl) {
  const parts = chunkText(text, 450);
  const out = [];
  for (const part of parts) {
    const url = GOOGLE_TL
      + "?client=dict-chrome-ex"
      + "&sl=" + encodeURIComponent(sl)
      + "&tl=" + encodeURIComponent(tl)
      + "&q=" + encodeURIComponent(part);
    const res = await withTimeout(fetch(url), TRANSLATE_TIMEOUT_MS, "translate-timeout");
    if (!res.ok) throw new Error("translate-http-" + res.status);
    const raw = await res.text();
    const translated = parseGoogleTranslation(raw);
    if (isBadTranslation(translated)) throw new Error("translate-empty");
    out.push(translated);
  }
  return out.join("\n").trim();
}

async function translateMyMemory(text, langpair) {
  const parts = chunkText(text, 400);
  const out = [];
  for (const part of parts) {
    const url = MYMEMORY + "?q=" + encodeURIComponent(part) + "&langpair=" + encodeURIComponent(langpair);
    const res = await withTimeout(fetch(url), TRANSLATE_TIMEOUT_MS, "translate-timeout");
    if (!res.ok) throw new Error("translate-http-" + res.status);
    const data = await res.json();
    const translated = data && data.responseData && data.responseData.translatedText;
    if (isBadTranslation(translated)) throw new Error("translate-quota");
    out.push(String(translated));
  }
  return out.join("\n").trim();
}

function polishTranslation(text, target) {
  if (!text) return text;
  if (target === "zh") {
    return text
      .replace(/頁邊空白處/g, "欄外（包裝外側）")
      .replace(/有效期限/g, "賞味期限")
      .replace(/儲存方法/g, "保存方法");
  }
  return text;
}

async function translateText(text, dir) {
  let out;
  try {
    out = await translateGoogle(text, dir.sl, dir.tl);
  } catch (err) {
    console.warn("google translate failed", err);
    out = await translateMyMemory(text, dir.pair);
  }
  return polishTranslation(out, dir.target);
}

async function ensureWanakana() {
  if (window.wanakana) return window.wanakana;
  await withTimeout(loadScript(WANAKANA_SRC), SCRIPT_TIMEOUT_MS, "wanakana-timeout");
  return window.wanakana;
}

async function ensureKuroshiro() {
  if (kuroReady) return kuroReady;
  kuroReady = (async () => {
    try {
      if (!window.Kuroshiro) await loadScript(KUROSHIRO_SRC);
      if (!window.KuromojiAnalyzer) await loadScript(KURO_ANALYZER_SRC);
      const Kuro = (window.Kuroshiro && window.Kuroshiro.default) || window.Kuroshiro;
      const Analyzer = (window.KuromojiAnalyzer && window.KuromojiAnalyzer.default) || window.KuromojiAnalyzer;
      if (!Kuro || !Analyzer) return null;
      const instance = new Kuro();
      await instance.init(new Analyzer({ dictPath: KUROMOJI_DICT }));
      return instance;
    } catch (err) {
      console.warn("kuroshiro init failed", err);
      kuroReady = null;
      return null;
    }
  })();
  return kuroReady;
}

function applyKuroReadings(jp, html, romaji) {
  if (lastSpoken !== jp) return;
  if (html && /<ruby/i.test(html)) setSafeRuby(furiganaEl, html);
  if (romaji) romajiEl.textContent = romaji;
}

async function convertWithKuro(kuro, jp) {
  if (!kuro || !jp) return false;
  try {
    const html = await kuro.convert(jp, { mode: "furigana", to: "hiragana" });
    const romaji = await kuro.convert(jp, { mode: "spaced", to: "romaji" });
    applyKuroReadings(jp, html, romaji);
    return true;
  } catch (err) {
    console.warn("kuroshiro convert failed", err);
    return false;
  }
}

async function fillFurigana(jp, waitMs) {
  if (!jp) return;
  const pending = ensureKuroshiro();
  const raced = await Promise.race([
    pending,
    new Promise((resolve) => setTimeout(() => resolve("timeout"), waitMs)),
  ]);
  if (raced && raced !== "timeout") {
    await convertWithKuro(raced, jp);
    return;
  }
  pending.then((kuro) => convertWithKuro(kuro, jp)).catch((err) => console.warn("kuroshiro late fill failed", err));
}

function readingsFromLexicon(jp, wk) {
  const keys = Object.keys(JP_READINGS).sort((a, b) => b.length - a.length);
  let i = 0;
  const hiraParts = [];
  while (i < jp.length) {
    let hit = "";
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      if (jp.startsWith(key, i)) {
        hit = key;
        break;
      }
    }
    if (hit) {
      hiraParts.push(JP_READINGS[hit]);
      i += hit.length;
      continue;
    }
    hiraParts.push(jp.charAt(i));
    i += 1;
  }
  const joined = hiraParts.join("");
  const hiragana = wk ? wk.toHiragana(joined) : joined;
  const romaji = wk ? wk.toRomaji(hiragana) : "";
  return { hiragana, romaji };
}

async function readingsFor(jp) {
  if (!jp) return { hiragana: "", romaji: "" };
  let wk = null;
  try {
    wk = await ensureWanakana();
  } catch (err) {
    console.warn("wanakana failed", err);
  }
  return readingsFromLexicon(jp, wk);
}

function pickJaVoice() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  return voices.find((v) => /^ja(-JP)?/i.test(v.lang)) || null;
}

function speakJa(text) {
  if (!text || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  const voice = pickJaVoice();
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

function handleFile(file) {
  if (!file || !file.type || file.type.indexOf("image/") !== 0) {
    if (file && !file.type) {
      // iOS sometimes omits type; still try
    } else if (file) {
      showError("請選一張照片。");
      return;
    } else {
      return;
    }
  }
  const myJob = ++jobId;
  results.hidden = false;
  if (speakBar) speakBar.hidden = false;
  showError("");
  showStatus("讀取照片…");
  preview.src = URL.createObjectURL(file);
  results.scrollIntoView({ behavior: "smooth", block: "start" });
  ensureWanakana().catch(() => {});
  ensureKuroshiro().catch(() => {});

  jobChain = jobChain.then(() => processJob(myJob, file)).catch((err) => {
    console.error(err);
  });
}

async function processJob(myJob, file) {
  const alive = () => myJob === jobId;
  try {
    const source = await fileToSource(file);
    if (!alive()) return;
    resizeToCanvas(source);
    if (source.close) {
      try { source.close(); } catch (e) {}
    }
    preview.src = frame.toDataURL("image/jpeg", 0.72);

    showStatus("準備辨識…");
    const ocr = await runOcr(alive);
    if (!alive()) return;
    ocrTextEl.textContent = ocr || "（沒有辨識到文字）";

    let jp = "";
    let translated = "";
    const dir = detectDirection(ocr || "");
    transHeading.textContent = dir.heading;

    if (ocr) {
      showStatus("翻譯中…");
      try {
        translated = await translateText(ocr, dir);
      } catch (err) {
        console.warn("translate failed", err);
        translated = "";
      }
    }
    if (!alive()) return;

    if (dir.target === "ja") {
      jp = translated || (hasKana(ocr) ? ocr : "");
      jpTextEl.textContent = translated || (jp || "翻譯失敗，原文仍在下方。可再拍一張。");
    } else {
      jp = ocr;
      jpTextEl.textContent = translated || "翻譯失敗，請再試一次。";
    }

    lastSpoken = jp;
    showStatus("產生念法…");
    const reading = await readingsFor(jp);
    if (!alive()) return;
    furiganaEl.textContent = reading.hiragana || jp || "（無法產生念法，可按朗讀）";
    romajiEl.textContent = reading.romaji || "（英文讀音載入中…）";
    await fillFurigana(jp, KURO_WAIT_MS);
    if (!alive()) return;
    if (!romajiEl.textContent || romajiEl.textContent.indexOf("載入中") !== -1) {
      if (reading.romaji) romajiEl.textContent = reading.romaji;
    }
    hideStatus();
  } catch (err) {
    console.error(err);
    if (!alive()) return;
    hideStatus();
    const msg = (err && err.message) || "";
    if (msg.indexOf("timeout") !== -1) {
      showError("處理逾時。請再拍一張，或改從相簿選較清楚的照片。");
    } else if (msg.indexOf("load failed") !== -1 || msg.indexOf("engine") !== -1) {
      showError("辨識引擎下載失敗。請確認網路後再拍一次。");
    } else {
      showError("處理失敗，請再拍一次或改選相簿。");
    }
  }
}

function showInstallHint() {
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (iOS && !standalone && installHint) installHint.hidden = false;
}

function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("sw register failed", err));
}

function init() {
  registerSw();
  showInstallHint();
  if (window.speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices());
  }
  ensureWanakana().catch(() => {});
  ensureKuroshiro().catch(() => {});
}

function onSpeak() {
  speakJa(lastSpoken);
}

speakBtn.addEventListener("click", onSpeak);
if (speakBarBtn) speakBarBtn.addEventListener("click", onSpeak);

captureInput.addEventListener("change", () => {
  const file = captureInput.files && captureInput.files[0];
  if (file) handleFile(file);
  captureInput.value = "";
});

albumInput.addEventListener("change", () => {
  const file = albumInput.files && albumInput.files[0];
  if (file) handleFile(file);
  albumInput.value = "";
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
