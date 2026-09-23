# gen_feed.py

import html
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

SITE_URL = "https://bs2fob.com/"
SITE_TITLE = {"ko": "Bs2FoB", "en": "Bs2FoB"}
SITE_DESC = {
    "ko": "확보된 거점 — 세운 것을 다음 출발점으로 넘긴다",
    "en": "Established footholds — each one becomes the next starting point",
}
AUTHOR = "Bs2FoB"
LOCALE = {"ko": "ko_KR", "en": "en_US"}
KST = timezone(timedelta(hours=9))
SEO_RE = re.compile(r"<!--seo-->.*?<!--/seo-->\r?\n?", re.S)
STAMP_RE = re.compile(r"^(\d{2})w(\d{2})(\d)v(\d{3})_(\d{2})(\d{2})$")


# 26w322v093_0912 = 26년 32주차 화요일 09시 3x분, 9월 12일
def parse_stamp(stamp):
    m = STAMP_RE.match(stamp or "")
    if not m:
        return None
    year = 2000 + int(m.group(1))
    hour = int(m.group(4)[:2])
    minute = int(m.group(4)[2]) * 10
    month, day = int(m.group(5)), int(m.group(6))
    try:
        return datetime(year, month, day, hour, minute, tzinfo=KST)
    except ValueError:
        return None


def load_posts(root):
    with io.open(os.path.join(root, "posts.json"), encoding="utf-8") as f:
        posts = json.load(f)
    posts.sort(key=lambda p: p.get("stamp", ""), reverse=True)
    return posts


# 해당 언어판이 없으면 원문으로 대신한다
def pick(post, lang):
    v = post.get(lang)
    if v and v.get("file"):
        return v
    for alt in ("ko", "en"):
        v = post.get(alt)
        if v and v.get("file"):
            return v
    return None


def esc(text):
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def rfc822(dt):
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return "%s, %02d %s %d %02d:%02d:00 +0900" % (
        names[dt.weekday()], dt.day, months[dt.month - 1],
        dt.year, dt.hour, dt.minute,
    )


def build_feed(posts, lang):
    now = datetime.now(KST)
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        "<channel>",
        "<title>%s</title>" % esc(SITE_TITLE[lang]),
        "<link>%s</link>" % esc(SITE_URL),
        "<description>%s</description>" % esc(SITE_DESC[lang]),
        "<language>%s</language>" % ("ko-kr" if lang == "ko" else "en-us"),
        "<lastBuildDate>%s</lastBuildDate>" % rfc822(now),
        '<atom:link href="%sfeed.%s.xml" rel="self" type="application/rss+xml"/>'
        % (esc(SITE_URL), lang),
    ]

    for post in posts:
        v = pick(post, lang)
        if not v:
            continue
        url = SITE_URL + v["file"]
        dt = parse_stamp(post.get("stamp")) or now
        lines += [
            "<item>",
            "<title>%s</title>" % esc(v.get("title", "")),
            "<link>%s</link>" % esc(url),
            '<guid isPermaLink="true">%s</guid>' % esc(url),
            "<pubDate>%s</pubDate>" % rfc822(dt),
            "<description>%s</description>" % esc(v.get("lede", "")),
            "</item>",
        ]

    lines += ["</channel>", "</rss>", ""]
    return "\n".join(lines)


def build_sitemap(posts):
    seen = set()
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "<url><loc>%s</loc></url>" % esc(SITE_URL),
    ]

    for post in posts:
        dt = parse_stamp(post.get("stamp"))
        mod = dt.strftime("%Y-%m-%d") if dt else None
        for lang in ("ko", "en"):
            v = post.get(lang)
            if not v or not v.get("file") or v["file"] in seen:
                continue
            seen.add(v["file"])
            url = SITE_URL + v["file"]
            lines.append(
                "<url><loc>%s</loc>%s</url>"
                % (esc(url), "<lastmod>%s</lastmod>" % mod if mod else "")
            )

    lines += ["</urlset>", ""]
    return "\n".join(lines)


def read_text(root, rel):
    path = os.path.join(root, rel)
    if not os.path.exists(path):
        return None
    with io.open(path, encoding="utf-8", newline="") as f:
        return f.read()


# 글 안의 첫 삽화, 없으면 사이트 아이콘
def first_image(text, rel):
    m = re.search(r'<img[^>]*\ssrc="([^"]+)"', text or "")
    if not m or m.group(1).startswith(("http:", "https:", "data:")):
        return SITE_URL + "apple-touch-icon.png"
    return SITE_URL + os.path.dirname(rel) + "/" + m.group(1)


def card_type(image):
    return "summary" if image.endswith("apple-touch-icon.png") else "summary_large_image"


def meta_desc(text, fallback):
    m = re.search(r'<meta name="description" content="([^"]*)"', text or "")
    return m.group(1) if m else esc(fallback)


# 글 파일 머리에 넣는 검색용 태그: 정식 주소, 언어판 짝, og, 구조화 데이터
def build_seo(post, lang, text):
    v = post[lang]
    url = SITE_URL + v["file"]
    title = esc(v.get("title", ""))
    desc = meta_desc(text, v.get("lede", ""))
    image = first_image(text, v["file"])
    dt = parse_stamp(post.get("stamp"))
    lines = ["<!--seo-->", '<link rel="canonical" href="%s">' % url]
    ko = (post.get("ko") or {}).get("file")
    en = (post.get("en") or {}).get("file")
    if ko and en and ko != en:
        lines += [
            '<link rel="alternate" hreflang="ko" href="%s%s">' % (SITE_URL, ko),
            '<link rel="alternate" hreflang="en" href="%s%s">' % (SITE_URL, en),
            '<link rel="alternate" hreflang="x-default" href="%s%s">' % (SITE_URL, en),
        ]
    lines += [
        '<meta property="og:type" content="article">',
        '<meta property="og:site_name" content="Bs2FoB">',
        '<meta property="og:locale" content="%s">' % LOCALE[lang],
        '<meta property="og:title" content="%s">' % title,
        '<meta property="og:description" content="%s">' % desc,
        '<meta property="og:url" content="%s">' % url,
        '<meta property="og:image" content="%s">' % image,
        '<meta name="twitter:card" content="%s">' % card_type(image),
    ]
    data = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": v.get("title", ""),
        "description": html.unescape(desc),
        "inLanguage": lang,
        "url": url,
        "mainEntityOfPage": url,
        "image": image,
        "author": {"@type": "Person", "name": AUTHOR, "url": SITE_URL},
        "publisher": {"@type": "Person", "name": AUTHOR, "url": SITE_URL},
        "isPartOf": {"@type": "WebSite", "name": "Bs2FoB", "url": SITE_URL},
    }
    if dt:
        data["datePublished"] = dt.isoformat()
    ld = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    lines += ['<script type="application/ld+json">%s</script>' % ld, "<!--/seo-->"]
    return "\n".join(lines) + "\n"


def write_heads(root, posts):
    done, seen = 0, set()
    for post in posts:
        for lang in ("ko", "en"):
            v = post.get(lang)
            if not v or not v.get("file") or v["file"] in seen:
                continue
            seen.add(v["file"])
            text = read_text(root, v["file"])
            if text is None or "</head>" not in text:
                continue
            new = SEO_RE.sub("", text)
            eol = "\r\n" if "\r\n" in new else "\n"
            block = build_seo(post, lang, new).replace("\n", eol)
            new = new.replace("</head>", block + "</head>", 1)
            if new != text:
                with io.open(os.path.join(root, v["file"]), "w", encoding="utf-8", newline="") as f:
                    f.write(new)
                done += 1
    print("p/  머리 태그 갱신 %d 개" % done)


TABS = [
    ("write", "작문", "Writing"),
    ("verse", "시문", "Verse"),
    ("voxchat", "복스챗", "VoxSermo"),
    ("snap", "스냅", "Snap"),
    ("notice", "로그", "Log"),
    ("code", "코딩", "Code"),
]
STATIC_RE = re.compile(r"<!--static-index-->.*?<!--/static-index-->", re.S)


# 연작은 번호순, 나머지는 최신순
def tab_posts(posts, tab):
    items = [p for p in posts if p.get("tab") == tab]
    if any(p.get("no") for p in items):
        items.sort(key=lambda p: (p.get("no") or "99_9", p.get("stamp", "")))
    return items


def label(post, lang):
    v = pick(post, lang)
    series = (post.get("series") or {}).get(lang)
    if series and post.get("no"):
        return "<%s %s> %s" % (series, post["no"], v.get("title", "")) if lang == "en" \
            else "<%s%s> %s" % (series, post["no"], v.get("title", ""))
    return v.get("title", "")


# 언어모델 에이전트용 사이트 안내. https://llmstxt.org 형식
def build_llms(posts):
    lines = [
        "# Bs2FoB",
        "",
        "> Essays by Bs2FoB on cognition, reasoning tools and method, published in Korean"
        " (original) and English. The core is the Cognitive Axioms series (인지공리).",
        "",
        "Every post is a static HTML file readable without JavaScript. Korean files end in"
        " `.ko.html`, English files in `.en.html`; the Korean text is the original and the"
        " English is the author's translation. Verse posts have a single file that carries"
        " the Korean poem with an English gloss. Series numbers read `set_part`"
        " (e.g. `02_3` is set 2, part 3). Machine-readable index: %sposts.json" % SITE_URL,
        "",
    ]
    for tab, _, en_name in TABS:
        items = tab_posts(posts, tab)
        if not items:
            continue
        lines += ["## Optional" if tab == "notice" else "## %s" % en_name, ""]
        for p in items:
            en, ko = pick(p, "en"), pick(p, "ko")
            note = en.get("lede", "")
            if ko["file"] != en["file"]:
                note += " Korean original: %s%s" % (SITE_URL, ko["file"])
            lines.append("- [%s](%s%s): %s" % (label(p, "en"), SITE_URL, en["file"], note.strip()))
        lines.append("")
    return "\n".join(lines)


# 스크립트 없이 읽는 쪽(에이전트, 수집기)에게 보이는 첫 화면 글 목록
def build_static_index(posts):
    out = ['<!--static-index-->', '<nav id="static-index">']
    for tab, ko_name, en_name in TABS:
        items = tab_posts(posts, tab)
        if not items:
            continue
        out.append("<h2>%s · %s</h2>" % (ko_name, en_name))
        out.append("<ul>")
        for p in items:
            ko, en = pick(p, "ko"), pick(p, "en")
            row = '<li><a href="%s">%s</a>' % (esc(ko["file"]), esc(label(p, "ko")))
            if en["file"] != ko["file"]:
                row += ' · <a href="%s" hreflang="en">%s</a>' % (esc(en["file"]), esc(label(p, "en")))
            row += " — %s</li>" % esc(ko.get("lede", ""))
            out.append(row)
        out.append("</ul>")
    out += ["</nav>", "<script>document.getElementById('static-index').remove();</script>",
            "<!--/static-index-->"]
    return "\n".join(out)


def write_static_index(root, posts):
    path = os.path.join(root, "index.html")
    text = read_text(root, "index.html")
    new = STATIC_RE.sub(lambda m: build_static_index(posts), text)
    if new != text:
        with io.open(path, "w", encoding="utf-8", newline="") as f:
            f.write(new)
    print("index.html  정적 목록 %s" % ("갱신" if new != text else "변화 없음"))


# 메신저 미리보기용 중간 페이지. 수집기는 og 태그를 읽고 사람은 사이트 안 글로 넘어간다
def build_share(root, post, lang):
    v = pick(post, lang)
    stamp = post["stamp"]
    title = esc(v.get("title", ""))
    lede = esc(v.get("lede", ""))
    target = "/?p=%s&lang=%s" % (stamp, lang)
    image = first_image(read_text(root, v["file"]), v["file"])
    return "\n".join([
        "<!DOCTYPE html>",
        '<html lang="%s">' % lang,
        "<head>",
        '<meta charset="UTF-8">',
        "<title>%s — Bs2FoB</title>" % title,
        '<meta name="description" content="%s">' % lede,
        '<meta property="og:type" content="article">',
        '<meta property="og:site_name" content="Bs2FoB">',
        '<meta property="og:title" content="%s">' % title,
        '<meta property="og:description" content="%s">' % lede,
        '<meta property="og:url" content="%ss/%s.%s.html">' % (SITE_URL, stamp, lang),
        '<meta property="og:image" content="%s">' % image,
        '<meta name="twitter:card" content="%s">' % card_type(image),
        '<link rel="canonical" href="%s%s">' % (SITE_URL, v["file"]),
        "<script>location.replace('%s');</script>" % target,
        "</head>",
        '<body><a href="%s">%s</a></body>' % (esc(target), title),
        "</html>",
        "",
    ])


def write_shares(root, posts):
    folder = os.path.join(root, "s")
    os.makedirs(folder, exist_ok=True)
    keep = set()
    for post in posts:
        if not parse_stamp(post.get("stamp")):
            continue
        for lang in ("ko", "en"):
            if not pick(post, lang):
                continue
            name = "%s.%s.html" % (post["stamp"], lang)
            keep.add(name)
            with io.open(os.path.join(folder, name), "w", encoding="utf-8", newline="\n") as f:
                f.write(build_share(root, post, lang))
    for name in os.listdir(folder):
        if name not in keep:
            os.remove(os.path.join(folder, name))
    print("s/  (%d 개)" % len(keep))


def write(root, name, text):
    path = os.path.join(root, name)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("%s  (%d bytes)" % (name, len(text.encode("utf-8"))))


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    posts = load_posts(root)

    bad = [p.get("stamp") for p in posts if not parse_stamp(p.get("stamp"))]
    if bad:
        print("타임스탬프 해석 실패: %s" % ", ".join(str(b) for b in bad))

    write(root, "feed.ko.xml", build_feed(posts, "ko"))
    write(root, "feed.en.xml", build_feed(posts, "en"))
    write(root, "sitemap.xml", build_sitemap(posts))
    write_shares(root, posts)
    write_heads(root, posts)
    write(root, "llms.txt", build_llms(posts))
    write_static_index(root, posts)
    print("글 %d 편" % len(posts))


if __name__ == "__main__":
    main()
