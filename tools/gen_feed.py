# gen_feed.py

import io
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

SITE_URL = "https://bs2fob.github.io/"
SITE_TITLE = {"ko": "Bs2FoB", "en": "Bs2FoB"}
SITE_DESC = {
    "ko": "확보된 거점 — 세운 것을 다음 출발점으로 넘긴다",
    "en": "Established footholds — each one becomes the next starting point",
}
KST = timezone(timedelta(hours=9))
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
    print("글 %d 편" % len(posts))


if __name__ == "__main__":
    main()
