// Supabase Edge Function: og
// 브라우저가 직접 못 긁는 사이트(reddit 등 antibot/CORS)의 og:image·title을 서버에서 추출.
// 핵심: Discordbot UA로 요청 → reddit·대부분 사이트가 social crawler엔 og 태그를 내줌.
// 브라우저는 UA 변조도 못 하고 CORS에도 막히므로 이 서버 경유가 유일한 방법.
//
// 호출: supabase.functions.invoke("og", { body: { url } }) → { title, image }
// 배포: supabase functions deploy og   (CLAUDE.md 참고)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// 최소 HTML 엔티티 디코드 (og:image URL의 &amp; 등)
const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// content 속성이 property 앞/뒤 어느 쪽에 오든 잡음
function og(html: string, prop: string): string {
  const a = html.match(
    new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i"),
  );
  const b = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i"),
  );
  return decode((a || b)?.[1] || "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let url = new URL(req.url).searchParams.get("url");
  if (!url && req.method === "POST") {
    url = await req.json().then((b) => b?.url).catch(() => null);
  }
  if (!url) return json({ error: "url required" }, 400);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    const html = await res.text();
    return json({ title: og(html, "title"), image: og(html, "image") });
  } catch (_e) {
    return json({ title: "", image: "" });
  }
});
