import { supabase, STORAGE_BUCKET } from "./supabase.js";
import { mapRow, toRow } from "./lib/map.mjs";
import { addAuthorName, removeAuthorName } from "./lib/authors.mjs";
import { normalizeSize } from "./lib/cardsize.mjs";
import { normalizeTheme } from "./lib/theme.mjs";
import { sha256Hex } from "./lib/hash.mjs";

// ========== STATE ==========
let links = [];
let authorFilter = '';
let selectedTags = new Set();
let selectedModalTags = new Set();
let allTags = [];   // 공유 태그 목록 (DB)
let selectedImageFiles = [];   // 링크 모달에서 새로 올릴 이미지 파일
let existingImages = [];        // 링크 수정 시 기존 이미지 URL
let selectedFiles = [];         // 새로 올릴 첨부파일(zip·워크플로 등)
let existingFiles = [];         // 수정 시 기존 첨부파일 [{name,url}]
const FILE_ALLOW = ["zip","7z","tar","gz","json","yaml","yml","safetensors","ckpt","pt","pth","txt","csv","png"];
const FILE_MAX = 25 * 1024 * 1024;   // 25MB
let fetchTimer = null;
let editId = null;
let pendingMeta = {};
let currentDetailLink = null;
let detailCommentChannel = null;

// ========== INIT / REALTIME ==========
let loadSeq = 0;
async function loadLinks() {
  const seq = ++loadSeq;
  const { data, error } = await supabase
    .from("links")
    .select("*")
    .order("created_at", { ascending: false });
  if (seq !== loadSeq) return;   // 더 최신 loadLinks가 시작됨 → 이 결과 폐기 (역할전환 레이스 방지)
  if (error) {
    document.getElementById("status").textContent = "DB 연결 실패: " + error.message;
    return;
  }
  let next = data.map(mapRow);
  // 게스트: admin 전용 글의 존재만 잠긴 티저 카드로 노출 (내용은 RLS가 차단해 받지 않음)
  if (!isAdmin) {
    const { data: locked } = await supabase.rpc("locked_links");
    if (seq !== loadSeq) return;
    if (locked?.length) next = next.concat(locked.map(r => ({ id: r.id, createdAt: r.created_at, locked: true })));
  }
  links = next;   // 한 번에 교체 — 동시 호출이 중간상태(append 누적)를 안 봄
  document.getElementById("status").style.display = "none";
  document.getElementById("grid").style.display = "grid";
  render();
  if (currentDetailLink) {
    const updated = links.find(l => l.id === currentDetailLink.id);
    if (updated) { currentDetailLink = updated; renderDetailStats(); }
  }
  _syncFromHash();   // 공유링크로 진입 / 로그인 후 재조회 시 해당 카드 자동 오픈
}

supabase
  .channel("links-rt")
  .on("postgres_changes", { event: "*", schema: "public", table: "links" }, loadLinks)
  .subscribe();

loadLinks();

// 공유 태그 로드 + 실시간
async function loadTags() {
  const { data, error } = await supabase
    .from("tags")
    .select("name")
    .order("created_at", { ascending: true });
  if (error) return;   // tags 테이블 없으면 조용히 무시 (필터바 비어있게)
  allTags = data.map(r => r.name);
  renderTagFilters();
  if (document.getElementById("modalBg").classList.contains("open")) renderModalTags();
}

supabase
  .channel("tags-rt")
  .on("postgres_changes", { event: "*", schema: "public", table: "tags" }, loadTags)
  .subscribe();

loadTags();

window.addTag = async function() {
  const raw = prompt("추가할 태그 이름:");
  const name = (raw || "").trim();
  if (!name) return;
  if (allTags.some(t => t.toLowerCase() === name.toLowerCase())) { alert("이미 있는 태그예요."); return; }
  const { error } = await supabase.from("tags").insert({ name, created_at: Date.now() });
  if (error) { alert("태그 추가 실패: " + error.message); return; }
  // 방금 추가한 태그를 작성 중인 링크에 바로 선택 상태로
  selectedModalTags.add(name);
  // 실시간 콜백이 renderTagFilters/renderModalTags 갱신
};

// ========== HELPERS ==========
function getDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}

function getSiteEmoji(url) {
  const d = getDomain(url);
  if (d.includes("youtube") || d.includes("youtu.be")) return "▶️";
  if (d.includes("instagram")) return "📸";
  if (d.includes("notion")) return "📄";
  if (d.includes("twitter") || d.includes("x.com")) return "𝕏";
  if (d.includes("github")) return "🐙";
  if (d.includes("figma")) return "🎨";
  return "🔗";
}

function escHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getLikedSet() {
  try { return new Set(JSON.parse(localStorage.getItem("likedLinks") || "[]")); } catch { return new Set(); }
}

function setLiked(id, liked) {
  const s = getLikedSet();
  if (liked) s.add(id); else s.delete(id);
  localStorage.setItem("likedLinks", JSON.stringify([...s]));
}

// ========== FEATURED ==========
function renderFeatured() {
  const section = document.getElementById("featuredSection");
  const scroll = document.getElementById("featuredScroll");
  const pinned = links
    .filter(l => {
      if (l.pinned !== true) return false;
      if (!isAdmin && l.adminOnly) return false;
      const tags = Array.isArray(l.tags) ? l.tags : (l.tag ? [l.tag] : []);
      const isPromptOnly = tags.includes("Prompt") && !l.url;
      return !isPromptOnly;
    })
    .sort((a, b) => (b.pinnedAt || b.createdAt || 0) - (a.pinnedAt || a.createdAt || 0));

  if (!pinned.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  scroll.innerHTML = pinned.map(l => {
    const thumbUrl = (l.images && l.images.length > 0) ? l.images[0] : l.image;
    const fallbackEmoji = l.url ? getSiteEmoji(l.url) : "💬";
    const thumb = thumbUrl
      ? `<img class="featured-thumb" src="${escHtml(thumbUrl)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy">
         <div class="featured-thumb-placeholder" style="display:none">${fallbackEmoji}</div>`
      : `<div class="featured-thumb-placeholder">${fallbackEmoji}</div>`;
    const domain = l.url ? getDomain(l.url) : "";
    return `
      <div class="featured-card" onclick="window._openDetail('${l.id}')">
        <span class="pin-badge">✦ PICK</span>
        ${thumb}
        <div class="featured-body">
          <div class="featured-card-title">${escHtml(l.title || domain || "제목 없음")}</div>
          <div class="featured-card-domain">${escHtml(domain)}</div>
          <div class="featured-card-meta">
            <span>♥ ${l.likes || 0}</span>
            <span>💬 ${l.commentCount || 0}</span>
          </div>
        </div>
      </div>`;
  }).join("");
}

// ========== RENDER CARDS ==========
function render() {
  renderFeatured();
  const searchQ = document.getElementById("searchInput").value.toLowerCase();
  const grid = document.getElementById("grid");
  const sortOrder = document.getElementById("sortSelect").value;
  const sorted = [...links].sort((a, b) => {
    if (sortOrder === "asc") return a.createdAt - b.createdAt;
    if (sortOrder === "likes") return (b.likes || 0) - (a.likes || 0);
    if (sortOrder === "comments") return (b.commentCount || 0) - (a.commentCount || 0);
    return b.createdAt - a.createdAt;
  });

  const badge = document.getElementById("authorFilterBadge");
  if (authorFilter) {
    badge.style.display = "inline-flex";
    badge.querySelector("span").textContent = `작성자: ${authorFilter}`;
  } else {
    badge.style.display = "none";
  }

  let filtered = sorted.filter(l => {
    const linkTags = Array.isArray(l.tags) ? l.tags : (l.tag ? [l.tag] : []);
    // Prompt-only items (no url, has promptText) are excluded from the main grid
    const isPromptOnly = linkTags.includes("Prompt") && !l.url;
    if (isPromptOnly) return false;
    if (!isAdmin && l.adminOnly) return false;
    const matchTag = selectedTags.size === 0 || linkTags.some(t => selectedTags.has(t));
    const matchQ = !searchQ || (l.title || "").toLowerCase().includes(searchQ) || (l.url || "").toLowerCase().includes(searchQ) || (l.desc || "").toLowerCase().includes(searchQ) || (l.author || "").toLowerCase().includes(searchQ);
    const matchAuthor = !authorFilter || (l.author || "") === authorFilter;
    return matchTag && matchQ && matchAuthor;
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty">링크가 없어요. 추가해보세요!</div>';
    return;
  }

  grid.innerHTML = filtered.map(l => {
    if (l.locked) return `
    <div class="card card-locked" title="Admin only access">
      <div class="card-thumb-placeholder locked-blur">🔒</div>
      <div class="card-body locked-blur">
        <div class="card-title">멤버 전용 콘텐츠</div>
        <div class="card-url">●●●●●●●●</div>
        <div class="card-desc">●●●● ●●●●● ●● ●●●●●●</div>
      </div>
      <div class="locked-overlay"><span>🔒 Admin only access</span></div>
    </div>`;
    const thumbUrl = (l.images && l.images.length > 0) ? l.images[0] : l.image;
    const fallbackEmoji = l.url ? getSiteEmoji(l.url) : "💬";
    const thumb = thumbUrl
      ? `<img class="card-thumb" src="${escHtml(thumbUrl)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy">
         <div class="card-thumb-placeholder" style="display:none">${fallbackEmoji}</div>`
      : `<div class="card-thumb-placeholder">${fallbackEmoji}</div>`;

    const tags = Array.isArray(l.tags) ? l.tags : (l.tag ? [l.tag] : ["기타"]);

    const isNew = l.createdAt && (Date.now() - l.createdAt) < 2 * 24 * 60 * 60 * 1000;
    return `
    <div class="card" onclick="window._openDetail('${l.id}')">
      ${isNew ? '<span class="new-badge">✦ NEW</span>' : ""}
      ${l.adminOnly ? '<span class="admin-badge">🔒</span>' : ''}
      ${thumb}
      <div class="card-body">
        <div class="card-title">${escHtml(l.title || (l.url ? getDomain(l.url) : "제목 없음"))}</div>
        <div class="card-url">${l.url ? escHtml(getDomain(l.url)) : ""}</div>
        <div class="card-desc">${escHtml(l.desc || l.promptIntro || "")}</div>
        <div class="card-bottom">
        <div class="card-footer">
          <div class="card-tags">${tags.map(t => `<span class="card-tag">${escHtml(t)}</span>`).join("")}</div>
        </div>
        <div style="font-size:10px;color:#99aabb;margin-top:4px;min-height:1.4em;display:flex;align-items:center;justify-content:space-between;">
          <span>${l.author ? `<span style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px" onclick="event.stopPropagation();window._filterByAuthor(${escHtml(JSON.stringify(l.author))})">by ${escHtml(l.author)}</span>` : ""}</span>
          <div class="card-actions" onclick="event.stopPropagation()">
            <button onclick="window._share('${l.id}', this)">공유</button>
            <button onclick="window._editLink('${l.id}')">수정</button>
            <button class="del-btn" onclick="window._deleteLink('${l.id}')">삭제</button>
          </div>
        </div>
        <div class="card-meta">
          <span class="eye-icon"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3C4.5 3 1.5 8 1.5 8C1.5 8 4.5 13 8 13C11.5 13 14.5 8 14.5 8C14.5 8 11.5 3 8 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg> ${l.views || 0}</span>
          <span>♥ ${l.likes || 0}</span>
          <span>💬 ${l.commentCount || 0}</span>
          ${l.createdAt ? `<span class="card-meta-date">${new Date(l.createdAt).toLocaleDateString("ko-KR", {year:"numeric",month:"long",day:"numeric"})}</span>` : ""}
        </div>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ========== DETAIL MODAL ==========
let carouselIndex = 0;

window._openDetail = async function(id) {
  const l = links.find(x => x.id === id);
  if (!l || l.locked) return;   // 잠긴 티저 카드는 열 수 없음 (내용 자체가 클라에 없음)
  currentDetailLink = l;
  if (location.hash !== "#c=" + id) location.hash = "c=" + id;   // 공유용 딥링크 (뒤로가기=닫기)

  // 조회수 증가 — DB RPC + 로컬 낙관적 +1 (realtime 왕복 기다리지 않고 즉시 반영)
  // .then() 필수 — supabase-js 빌더는 thenable이라 안 붙이면 요청이 발사조차 안 됨
  supabase.rpc("increment_views", { row_id: id }).then(() => {}, () => {});
  l.views = (l.views || 0) + 1;
  render();  // 메인 카드도 즉시 갱신 (realtime 왕복 안 기다림)

  // 썸네일 / 캐러셀
  const thumbWrap = document.getElementById("detailThumbWrap");
  const images = (l.images && l.images.length > 0) ? l.images : (l.image ? [l.image] : []);
  carouselIndex = 0;

  if (images.length > 1) {
    thumbWrap.innerHTML = `
      <div class="carousel">
        <div class="carousel-slides">
          ${images.map((img, i) => `
            <div class="carousel-slide ${i === 0 ? "active" : ""}">
              <img src="${escHtml(img)}" alt="">
            </div>`).join("")}
        </div>
        <button class="carousel-btn prev" onclick="event.stopPropagation();window._carouselPrev()">&#8249;</button>
        <button class="carousel-btn next" onclick="event.stopPropagation();window._carouselNext()">&#8250;</button>
        <div class="carousel-dots">
          ${images.map((_, i) => `<button class="carousel-dot ${i === 0 ? "active" : ""}" onclick="event.stopPropagation();window._carouselGo(${i})"></button>`).join("")}
        </div>
      </div>`;
    thumbWrap.onclick = null;
    thumbWrap.style.cursor = "default";
  } else if (images.length === 1) {
    thumbWrap.innerHTML = `<img src="${escHtml(images[0])}" alt="">
      ${l.url ? '<div class="detail-thumb-overlay"><span>사이트 방문 →</span></div>' : ""}`;
    thumbWrap.onclick = l.url ? () => window.open(l.url, "_blank", "noopener") : null;
    thumbWrap.style.cursor = l.url ? "pointer" : "default";
  } else {
    const fallback = l.url ? getSiteEmoji(l.url) : "💬";
    thumbWrap.innerHTML = `<div class="detail-thumb-placeholder">${fallback}</div>
      ${l.url ? '<div class="detail-thumb-overlay"><span>사이트 방문 →</span></div>' : ""}`;
    thumbWrap.onclick = l.url ? () => window.open(l.url, "_blank", "noopener") : null;
    thumbWrap.style.cursor = l.url ? "pointer" : "default";
  }

  // 태그
  const tags = Array.isArray(l.tags) ? l.tags : (l.tag ? [l.tag] : ["기타"]);
  document.getElementById("detailTags").innerHTML = tags.map(t => `<span class="detail-tag">${escHtml(t)}</span>`).join("");

  // 제목
  document.getElementById("detailTitle").textContent = l.title || getDomain(l.url);

  // 메타
  const metaParts = [];
  if (l.author) metaParts.push(`👤 ${escHtml(l.author)}`);
  if (l.createdAt) metaParts.push(`📅 ${new Date(l.createdAt).toLocaleDateString("ko-KR", {year:"numeric",month:"2-digit",day:"2-digit"})}`);
  if (l.url) metaParts.push(`🔗 ${escHtml(getDomain(l.url))}`);
  document.getElementById("detailMeta").innerHTML = metaParts.map(p => `<span>${p}</span>`).join("");

  // 설명
  document.getElementById("detailDesc").textContent = l.desc || "";

  // 첨부파일 (다운로드 강제: ?download=원본이름)
  const atts = Array.isArray(l.files) ? l.files : [];
  document.getElementById("detailFiles").innerHTML = atts.length
    ? `<div class="detail-files-title">📎 첨부파일</div>` + atts.map(f =>
        `<a class="file-dl" href="${escHtml(f.url)}?download=${encodeURIComponent(f.name)}" target="_blank" rel="noopener">⬇ ${escHtml(f.name)}</a>`).join("")
    : "";

  // 통계
  renderDetailStats();

  // 프롬프트 섹션 — trigger tag is 'Prompt'
  const body = document.getElementById("detailBody");
  if (tags.includes("Prompt") && (l.promptIntro || l.promptEnv || l.promptText || l.promptTip)) {
    let html = "";
    if (l.promptIntro) html += `
      <div class="detail-section">
        <div class="detail-section-title">프롬프트 소개</div>
        <div class="detail-section-content">${escHtml(l.promptIntro)}</div>
      </div>`;
    if (l.promptEnv) html += `
      <div class="detail-section">
        <div class="detail-section-title">실행환경</div>
        <div class="detail-section-content">${escHtml(l.promptEnv)}</div>
      </div>`;
    if (l.promptText) html += `
      <div class="detail-section">
        <div class="detail-section-title">
          <span>프롬프트</span>
          <button class="copy-btn" id="copyPromptBtn" onclick="window._copyPrompt()">복사하기</button>
        </div>
        <div class="detail-section-content">${escHtml(l.promptText)}</div>
      </div>`;
    if (l.promptTip) html += `
      <div class="detail-section">
        <div class="detail-section-title">활용 팁</div>
        <div class="detail-section-content">${escHtml(l.promptTip)}</div>
      </div>`;
    body.innerHTML = html;
    body.style.display = "block";
  } else {
    body.innerHTML = "";
    body.style.display = "none";
  }

  // 댓글 실시간 구독 (Supabase Realtime)
  if (detailCommentChannel) {
    supabase.removeChannel(detailCommentChannel);
    detailCommentChannel = null;
  }

  // initial load
  async function loadComments() {
    const { data, error } = await supabase
      .from("comments")
      .select("id, link_id, author, text, created_at")
      .eq("link_id", id)
      .order("created_at", { ascending: true });
    if (!error) renderComments((data || []).map(mapRow));
  }
  await loadComments();

  detailCommentChannel = supabase
    .channel(`comments-${id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `link_id=eq.${id}` }, loadComments)
    .subscribe();

  document.getElementById("detailBg").classList.add("open");
};

function renderDetailStats() {
  if (!currentDetailLink) return;
  const l = currentDetailLink;
  const liked = getLikedSet().has(l.id);
  document.getElementById("detailStats").innerHTML = `
    <button class="like-btn ${liked ? "liked" : ""}" id="likeBtn" onclick="window._toggleLike()">
      ${liked ? "♥" : "♡"} 좋아요 ${l.likes || 0}
    </button>
    <span class="stat-item eye-icon"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3C4.5 3 1.5 8 1.5 8C1.5 8 4.5 13 8 13C11.5 13 14.5 8 14.5 8C14.5 8 11.5 3 8 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg> 조회수 ${l.views || 0}</span>
  `;
}

window._toggleLike = async function() {
  if (!currentDetailLink) return;
  const id = currentDetailLink.id;
  const liked = getLikedSet().has(id);
  setLiked(id, !liked);
  await supabase.rpc("adjust_likes", { row_id: id, delta: liked ? -1 : 1 });
};

window._copyPrompt = function() {
  if (!currentDetailLink || !currentDetailLink.promptText) return;
  navigator.clipboard.writeText(currentDetailLink.promptText).then(() => {
    const btn = document.getElementById("copyPromptBtn");
    if (btn) {
      btn.textContent = "복사됨!";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = "복사하기"; btn.classList.remove("copied"); }, 2000);
    }
  });
};

function renderComments(comments) {
  const list = document.getElementById("commentsList");
  if (!comments.length) {
    list.innerHTML = '<div style="color:#444;font-size:13px;padding:4px 0 12px">첫 댓글을 남겨보세요!</div>';
    bindCommentDelete();
    return;
  }
  list.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-avatar">${(c.author || "?")[0].toUpperCase()}</div>
      <div class="comment-content">
        <div class="comment-author">${escHtml(c.author || "익명")}</div>
        <div class="comment-text">${escHtml(c.text)}</div>
        <div class="comment-date">${c.createdAt ? new Date(c.createdAt).toLocaleString("ko-KR", {year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}) : ""}</div>
      </div>
      <button type="button" class="comment-del" data-cid="${c.id}">✕</button>
    </div>`).join("");
  bindCommentDelete();
}

function bindCommentDelete() {
  const list = document.getElementById("commentsList");
  if (list.dataset.bound) return;
  list.addEventListener("click", async e => {
    const b = e.target.closest(".comment-del"); if (!b) return;
    const id = b.dataset.cid;
    if (isAdmin) {
      if (!confirm("이 댓글을 삭제할까요?")) return;
      const { error } = await supabase.rpc("delete_comment_admin", { comment_id: id });
      if (error) alert("삭제 실패: " + error.message);
    } else {
      const pw = prompt("댓글 삭제 암호:");
      if (!pw) return;
      await supabase.rpc("delete_comment", { comment_id: id, pw });
      // 일치하지 않으면 아무 행도 안 지워짐(조용). 실시간 구독이 목록 갱신.
    }
  });
  list.dataset.bound = "1";
}

window.submitComment = async function() {
  if (!currentDetailLink) return;
  const author = document.getElementById("commentAuthor").value.trim() || "익명";
  const text = document.getElementById("commentText").value.trim();
  if (!text) return;
  const pw = document.getElementById("commentPw").value;
  const row = { link_id: currentDetailLink.id, author, text, created_at: Date.now() };
  if (pw) row.del_hash = await sha256Hex(pw);
  const { error } = await supabase.from("comments").insert(row);
  if (error) { alert("댓글 등록 실패: " + error.message); return; }
  document.getElementById("commentText").value = "";
  document.getElementById("commentPw").value = "";
};

function _closeDetailUI() {
  document.getElementById("detailBg").classList.remove("open");
  if (detailCommentChannel) {
    supabase.removeChannel(detailCommentChannel);
    detailCommentChannel = null;
  }
  currentDetailLink = null;
}
window.closeDetail = function() {
  _closeDetailUI();
  if (location.hash) history.replaceState("", "", location.pathname + location.search);   // hash 제거 (재진입 없음)
};

// 공유: 현재(또는 지정) 카드 딥링크 클립보드 복사
window._share = function(id, btn) {
  id = id || (currentDetailLink && currentDetailLink.id);
  if (!id) return;
  const el = btn || document.getElementById("detailShareBtn");   // 카드=클릭버튼, 디테일=헤더버튼
  const url = location.origin + location.pathname + "#c=" + id;
  navigator.clipboard.writeText(url).then(() => {
    if (el) { const o = el.innerHTML; el.textContent = "✓"; setTimeout(() => { el.innerHTML = o; }, 1500); }
  });
};

// hash(#c=id) ↔ 디테일 모달 동기화. 공유링크/뒤로가기/로드 전부 여기로
function _syncFromHash() {
  const id = new URLSearchParams(location.hash.slice(1)).get("c");
  if (!id) { if (currentDetailLink) _closeDetailUI(); return; }   // hash 비면 닫기 (뒤로가기)
  if (currentDetailLink && currentDetailLink.id === id) return;   // 이미 열림 → 루프 방지
  const l = links.find(x => x.id === id);
  if (!l || l.locked) { showAuthOverlay(); return; }   // admin 전용/모르는 카드 → 로그인 필요창
  window._openDetail(id);
}
window.addEventListener("hashchange", _syncFromHash);

document.getElementById("detailBg").addEventListener("click", e => {
  if (e.target === document.getElementById("detailBg")) window.closeDetail();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (document.getElementById("detailBg").classList.contains("open")) window.closeDetail();
    else window.closeModal();
  }
});

// ========== TAG FILTERS (DB 동적 렌더 + 위임) ==========
function renderTagFilters() {
  const box = document.getElementById("tagFilters");
  if (!box) return;
  const chips = [`<button class="tag-btn${selectedTags.size === 0 ? " active" : ""}" data-tag="전체">전체</button>`]
    .concat(allTags.map(t =>
      `<button class="tag-btn${selectedTags.has(t) ? " active" : ""}" data-tag="${escHtml(t)}">${escHtml(t)}</button>`));
  box.innerHTML = chips.join("");
  if (!box.dataset.bound) {
    box.addEventListener("click", e => {
      const btn = e.target.closest(".tag-btn"); if (!btn) return;
      const tag = btn.dataset.tag;
      if (tag === "전체") selectedTags.clear();
      else if (selectedTags.has(tag)) selectedTags.delete(tag);
      else selectedTags.add(tag);
      renderTagFilters();
      render();
    });
    box.dataset.bound = "1";
  }
}

document.getElementById("searchInput").addEventListener("input", render);
document.getElementById("sortSelect").addEventListener("change", render);

// ========== ADD/EDIT MODAL ==========
function updatePromptFields() {
  document.getElementById("promptFields").classList.toggle("visible", selectedModalTags.has("Prompt"));
}

// 모달 태그 칩 (DB 동적 렌더 + 위임)
function renderModalTags() {
  const box = document.getElementById("modalTags");
  if (!box) return;
  box.innerHTML = allTags.map(t => {
    const e = escHtml(t);
    return `<button type="button" class="modal-tag${selectedModalTags.has(t) ? " selected" : ""}" data-tag="${e}">${e}<span class="tag-del" title="태그 삭제">✕</span></button>`;
  }).join("");
  if (!box.dataset.bound) {
    box.addEventListener("click", async e => {
      const btn = e.target.closest(".modal-tag"); if (!btn) return;
      const tag = btn.dataset.tag;
      if (e.target.classList.contains("tag-del")) {
        if (!confirm(`'${tag}' 태그를 삭제할까요?\n모두에게 공유되는 태그입니다.`)) return;
        selectedModalTags.delete(tag);
        selectedTags.delete(tag);   // 필터바에 남은 활성 필터도 정리
        const { error } = await supabase.from("tags").delete().eq("name", tag);
        if (error) alert("태그 삭제 실패: " + error.message);
        return;   // 실시간 콜백이 재렌더
      }
      if (selectedModalTags.has(tag)) selectedModalTags.delete(tag);
      else selectedModalTags.add(tag);
      btn.classList.toggle("selected");
      updatePromptFields();
    });
    box.dataset.bound = "1";
  }
}

window.openModal = function(id) {
  editId = id || null;
  pendingMeta = {};
  document.getElementById("modalTitle").textContent = id ? "링크 수정" : "링크 추가";
  document.getElementById("modalBg").classList.add("open");

  if (id) {
    const l = links.find(x => x.id === id);
    if (!l) { window.closeModal(); return; }
    document.getElementById("urlInput").value = l.url || "";
    document.getElementById("titleInput").value = l.title || "";
    document.getElementById("descInput").value = l.desc || "";
    document.getElementById("authorInput").value = l.author || "";
    document.getElementById("promptIntroInput").value = l.promptIntro || "";
    document.getElementById("promptEnvInput").value = l.promptEnv || "";
    document.getElementById("promptTextInput").value = l.promptText || "";
    document.getElementById("promptTipInput").value = l.promptTip || "";
    document.getElementById("pinnedInput").checked = l.pinned === true;
    document.getElementById("adminOnlyInput").checked = l.adminOnly === true;
    const existingTags = Array.isArray(l.tags) ? l.tags : (l.tag ? [l.tag] : []);
    selectedModalTags = new Set(existingTags);
    pendingMeta = { image: l.image };
    existingImages = Array.isArray(l.images) ? [...l.images] : [];
    existingFiles = Array.isArray(l.files) ? [...l.files] : [];
    // 썸네일 없는 옛 행을 수정 열면 자동 재추출 (URL .value 세팅은 input 이벤트를 안 터뜨려 fetchMeta가 안 돌기 때문)
    if (l.url && !l.image && existingImages.length === 0) fetchMeta(l.url);
  } else {
    ["urlInput","titleInput","descInput","authorInput","promptIntroInput","promptEnvInput","promptTextInput","promptTipInput"].forEach(fieldId => {
      document.getElementById(fieldId).value = "";
    });
    document.getElementById("pinnedInput").checked = false;
    document.getElementById("adminOnlyInput").checked = false;
    selectedModalTags = new Set();
    existingImages = [];
    existingFiles = [];
  }

  selectedImageFiles = [];
  selectedFiles = [];
  renderUploadPreview();
  renderFilePreview();
  renderModalTags();
  updatePromptFields();
};

window.closeModal = function() {
  document.getElementById("modalBg").classList.remove("open");
  clearTimeout(fetchTimer);
};

let mousedownTarget = null;
document.getElementById("modalBg").addEventListener("mousedown", e => { mousedownTarget = e.target; });

window.handleBgClick = function(e) {
  if (e.target === document.getElementById("modalBg") && mousedownTarget === document.getElementById("modalBg")) {
    window.closeModal();
  }
};

window.onUrlChange = function() {
  clearTimeout(fetchTimer);
  const url = document.getElementById("urlInput").value.trim();
  if (!url || !url.startsWith("http")) return;
  fetchTimer = setTimeout(() => fetchMeta(url), 800);
};

async function fetchMeta(url) {
  const saveBtn = document.getElementById("saveBtn");
  saveBtn.textContent = "불러오는 중...";
  saveBtn.disabled = true;
  // HF·reddit 등 antibot 사이트 포함 모든 og:image는 아래 og 프록시(Discordbot UA)가 처리.
  const setMeta = (title, image) => {
    pendingMeta = { title: title || "", image: image || "" };
    const ti = document.getElementById("titleInput");
    if (!ti.value) ti.value = pendingMeta.title;
  };
  // 1차: 자체 og 프록시(Edge Function). Discordbot UA라 reddit 등 antibot 사이트도 통과.
  try {
    const { data } = await supabase.functions.invoke("og", { body: { url } });
    if (data?.image) {
      setMeta(data.title, data.image);
      saveBtn.textContent = "저장";
      saveBtn.disabled = false;
      return;
    }
  } catch(e) {}
  // 2차: microlink — og 없는 사이트는 스크린샷 fallback 제공.
  try {
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (data.status === "success") {
      setMeta(data.data.title, data.data.image?.url || data.data.screenshot?.url);
    }
  } catch(e) {}
  saveBtn.textContent = "저장";
  saveBtn.disabled = false;
}

window.saveLink = async function() {
  const url = document.getElementById("urlInput").value.trim();
  const title = document.getElementById("titleInput").value.trim() || getDomain(url);
  const desc = document.getElementById("descInput").value.trim();
  const author = document.getElementById("authorInput").value.trim();
  const tags = [...selectedModalTags];
  if (!url && !title && !selectedImageFiles.length && !existingImages.length) {
    alert("URL · 제목 · 이미지 중 하나는 필요해요.");
    return;
  }

  const saveBtn = document.getElementById("saveBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = (selectedImageFiles.length || selectedFiles.length) ? "업로드 중..." : "저장 중...";

  try {
    // 새 이미지 업로드 (압축 → Storage)
    const uploaded = [];
    for (const file of selectedImageFiles) {
      const blob = await compressToBlob(file);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      uploaded.push(pub.publicUrl);
    }
    const images = [...existingImages, ...uploaded];

    // 첨부파일 원본 업로드 (압축 없음). files/ 하위 경로.
    const uploadedFiles = [];
    for (const file of selectedFiles) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `files/${Date.now()}_${safeName}`;
      const { error: fErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (fErr) throw fErr;
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      uploadedFiles.push({ name: file.name, url: pub.publicUrl });
    }
    const files = [...existingFiles, ...uploadedFiles];

    const data = { url, title, desc, author, tags, image: pendingMeta.image || "", images, files };
    data.adminOnly = document.getElementById("adminOnlyInput").checked;

    const pinned = document.getElementById("pinnedInput").checked;
    const existing = editId ? links.find(l => l.id === editId) : null;
    const wasPinned = existing && existing.pinned === true;
    data.pinned = pinned;
    if (pinned && !wasPinned) data.pinnedAt = Date.now();

    if (tags.includes("Prompt")) {
      data.promptIntro = document.getElementById("promptIntroInput").value.trim();
      data.promptEnv = document.getElementById("promptEnvInput").value.trim();
      data.promptText = document.getElementById("promptTextInput").value.trim();
      data.promptTip = document.getElementById("promptTipInput").value.trim();
    }

    if (editId) {
      const { error } = await supabase.from("links").update(toRow(data)).eq("id", editId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("links").insert(toRow({
        ...data,
        createdAt: Date.now(),
        views: 0,
        likes: 0,
        commentCount: 0
      }));
      if (error) throw error;
    }
    window.closeModal();
  } catch(e) {
    alert("저장 실패: " + e.message);
  }

  saveBtn.disabled = false;
  saveBtn.textContent = "저장";
};

window._editLink = function(id) { window.openModal(id); };

window._filterByAuthor = function(author) {
  authorFilter = author;
  render();
};

window._clearAuthorFilter = function() {
  authorFilter = "";
  render();
};

window._deleteLink = async function(id) {
  if (!confirm("삭제할까요?")) return;
  try {
    // FK on delete cascade handles comments automatically
    const { error } = await supabase.from("links").delete().eq("id", id);
    if (error) throw error;
  } catch(e) {
    alert("삭제 실패: " + e.message);
  }
};

// ========== CAROUSEL ==========
window._carouselPrev = function() {
  const slides = document.querySelectorAll(".carousel-slide");
  const dots = document.querySelectorAll(".carousel-dot");
  if (!slides.length) return;
  slides[carouselIndex].classList.remove("active");
  dots[carouselIndex].classList.remove("active");
  carouselIndex = (carouselIndex - 1 + slides.length) % slides.length;
  slides[carouselIndex].classList.add("active");
  dots[carouselIndex].classList.add("active");
};

window._carouselNext = function() {
  const slides = document.querySelectorAll(".carousel-slide");
  const dots = document.querySelectorAll(".carousel-dot");
  if (!slides.length) return;
  slides[carouselIndex].classList.remove("active");
  dots[carouselIndex].classList.remove("active");
  carouselIndex = (carouselIndex + 1) % slides.length;
  slides[carouselIndex].classList.add("active");
  dots[carouselIndex].classList.add("active");
};

window._carouselGo = function(i) {
  const slides = document.querySelectorAll(".carousel-slide");
  const dots = document.querySelectorAll(".carousel-dot");
  if (!slides.length) return;
  slides[carouselIndex].classList.remove("active");
  dots[carouselIndex].classList.remove("active");
  carouselIndex = i;
  slides[carouselIndex].classList.add("active");
  dots[carouselIndex].classList.add("active");
};

// ========== 이미지 업로드 (링크 모달) ==========
window.handleImageSelect = function(e) {
  selectedImageFiles = [...selectedImageFiles, ...[...e.target.files]];
  e.target.value = "";
  renderUploadPreview();
};

function renderUploadPreview() {
  const preview = document.getElementById("uploadPreview");
  if (!preview) return;
  const thumbs = [
    ...existingImages.map((url, i) => `
      <div class="upload-thumb">
        <img src="${escHtml(url)}" alt="">
        <button type="button" onclick="window._removeImage('e',${i})">✕</button>
      </div>`),
    ...selectedImageFiles.map((f, i) => `
      <div class="upload-thumb">
        <img src="${URL.createObjectURL(f)}" alt="">
        <button type="button" onclick="window._removeImage('n',${i})">✕</button>
      </div>`)
  ];
  preview.innerHTML = thumbs.join("");
}

window._removeImage = function(kind, i) {
  if (kind === "e") existingImages.splice(i, 1);
  else selectedImageFiles.splice(i, 1);
  renderUploadPreview();
};

window.handleFileSelect = function(e) {
  for (const f of [...e.target.files]) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!FILE_ALLOW.includes(ext)) { alert(`허용 안 되는 형식: .${ext}`); continue; }
    if (f.size > FILE_MAX) { alert(`${f.name} — 25MB 초과 (${(f.size/1048576).toFixed(1)}MB)`); continue; }
    selectedFiles.push(f);
  }
  e.target.value = "";
  renderFilePreview();
};

function renderFilePreview() {
  const box = document.getElementById("filePreview");
  if (!box) return;
  box.innerHTML = [
    ...existingFiles.map((f, i) => `
      <div class="file-chip"><span>📎 ${escHtml(f.name)}</span>
        <button type="button" onclick="window._removeFile('e',${i})">✕</button></div>`),
    ...selectedFiles.map((f, i) => `
      <div class="file-chip"><span>📎 ${escHtml(f.name)} <em>(${(f.size/1048576).toFixed(1)}MB)</em></span>
        <button type="button" onclick="window._removeFile('n',${i})">✕</button></div>`)
  ].join("");
}

window._removeFile = function(kind, i) {
  if (kind === "e") existingFiles.splice(i, 1);
  else selectedFiles.splice(i, 1);
  renderFilePreview();
};

// compress image file to blob (used when uploading link images)
async function compressToBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => {
      img.onload = () => {
        const MAX = 600;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error("canvas.toBlob failed"));
        }, "image/jpeg", 0.65);
      };
      img.onerror = () => reject(new Error(`"${file.name}" 이미지를 읽을 수 없습니다 (HEIC/지원하지 않는 형식)`));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error(`"${file.name}" 파일 읽기 실패`));
    reader.readAsDataURL(file);
  });
}

// ========== 작성자 퀵버튼 ==========
const AUTHORS_KEY = "patAuthors";
function getAuthors(){ try{ return JSON.parse(localStorage.getItem(AUTHORS_KEY)) || ["Pat"]; }catch{ return ["Pat"]; } }
function saveAuthors(a){ localStorage.setItem(AUTHORS_KEY, JSON.stringify(a)); }
function renderAuthors(){
  const box = document.getElementById("authorQuickBtns");
  if (!box) return;
  // data-idx + 위임 리스너: 이름 문자열을 마크업/JS에 끼워넣지 않아 따옴표·역슬래시 이스케이프 불필요
  box.innerHTML = getAuthors().map((n, i) =>
    `<span class="author-chip"><button type="button" data-act="set" data-idx="${i}">${escHtml(n)}</button><button type="button" class="author-x" data-act="del" data-idx="${i}">✕</button></span>`
  ).join("");
  if (!box.dataset.bound) {
    box.addEventListener("click", e => {
      const b = e.target.closest("button[data-idx]"); if(!b) return;
      const n = getAuthors()[+b.dataset.idx]; if(n == null) return;
      if (b.dataset.act === "set") window._setAuthor(n);
      else if (b.dataset.act === "del") window._removeAuthor(n);
    });
    box.dataset.bound = "1";
  }
}
window._setAuthor = n => {
  const a = document.getElementById("authorInput"); if(a) a.value = n;
  const p = document.getElementById("pAuthorInput"); if(p) p.value = n;
};
window.addAuthor = () => {
  const n = prompt("추가할 이름:"); if(!n) return;
  saveAuthors(addAuthorName(getAuthors(), n)); renderAuthors();
};
window._removeAuthor = n => { saveAuthors(removeAuthorName(getAuthors(), n)); renderAuthors(); };
renderAuthors();

// ========== 카드 크기 / 테마 ==========
function applySize(size) {
  const s = normalizeSize(size);
  document.documentElement.dataset.size = s;
  localStorage.setItem("cardSize", s);
  document.querySelectorAll("#sizeToggle .size-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.size === s));
}
function applyTheme(theme) {
  const t = normalizeTheme(theme);
  document.documentElement.dataset.theme = t;
  localStorage.setItem("theme", t);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = t === "dark" ? "🌙" : "☀";
}
window.toggleTheme = function() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "day" : "dark");
};
const sizeBox = document.getElementById("sizeToggle");
if (sizeBox) sizeBox.addEventListener("click", e => {
  const b = e.target.closest(".size-btn");
  if (b) applySize(b.dataset.size);
});
applySize(localStorage.getItem("cardSize"));   // null이면 normalizeSize가 'm'
applyTheme(localStorage.getItem("theme"));      // null이면 normalizeTheme가 'day'

// ========== 인증 / 역할 (admin/guest) ==========
let isAdmin = false;
function setRole(admin) {
  isAdmin = admin;
  document.documentElement.dataset.role = admin ? "admin" : "guest";
  loadLinks();   // 역할 바뀌면 권한에 맞게 재조회 (admin=실데이터, 게스트=잠긴 티저). loadLinks가 render 호출
}
function showAuthOverlay() { document.getElementById("authOverlay").classList.add("open"); }
function hideAuthOverlay() { document.getElementById("authOverlay").classList.remove("open"); }
window.showLogin = showAuthOverlay;   // 게스트가 헤더 LOGIN 버튼으로 언제든 로그인 화면 열기

window.adminLogin = async function() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPw").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { document.getElementById("loginError").textContent = "로그인 실패: " + error.message; return; }
  localStorage.removeItem("patGuest");
  hideAuthOverlay();   // onAuthStateChange가 admin 역할 설정
};
window.enterAsGuest = function() {
  localStorage.setItem("patGuest", "1");
  setRole(false);
  hideAuthOverlay();
};
window.logout = async function() {
  await supabase.auth.signOut();
  localStorage.removeItem("patGuest");
  setRole(false);
  showAuthOverlay();
};

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) { setRole(true); hideAuthOverlay(); }
  else { setRole(false); }
});

(async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { setRole(true); hideAuthOverlay(); }
  else if (localStorage.getItem("patGuest") === "1") { setRole(false); hideAuthOverlay(); }
  else { setRole(false); showAuthOverlay(); }
})();
