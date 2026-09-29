# new_log.py

import glob
import html
import io
import json
import os
import re
import sys

STAMP_RE = re.compile(r"^\d{2}w\d{3}v\d{3}_\d{4}$")
SLUG_RE = re.compile(r"^[a-z0-9]{1,24}$")
CSS_RE = re.compile(r"post\.css\?v=(\d+)")

PAGE = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>if(screen.width<500)document.querySelector('meta[name=viewport]').content='width=500';</script>
<title>{title} — Bs2FoB</title>
<meta name="description" content="{lede}">
<link rel="icon" href="../favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="../favicon-32.png">
<link rel="apple-touch-icon" href="../apple-touch-icon.png">
<link rel="stylesheet" href="../post.css?v={css}">
</head>
<body>
<div class="wrap">

  <nav class="topbar">
    <a class="back" href="../">← 목록</a>
  </nav>

  <header class="post-head">
    <h1 class="post-title">{title}</h1>
    <div class="post-stamp">{stamp} Bs2FoB</div>
  </header>

  <main>
{body}
  </main>

  <footer class="post-foot">{stamp} Bs2FoB</footer>

</div>
<script>(function(){{if(/X11; Linux/.test(navigator.userAgent))return;var s=document.createElement('script');s.async=true;s.src='//gc.zgo.at/count.js';s.dataset.goatcounter='https://bs2fob.goatcounter.com/count';document.body.appendChild(s);}})();</script>
</body>
</html>
"""


def read(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return f.read()


# 글 파일들이 쓰는 post.css 버전 중 가장 높은 값을 따른다
def css_version(root):
    vs = [int(v) for f in glob.glob(os.path.join(root, "p", "*.html")) for v in CSS_RE.findall(read(f))]
    return max(vs) if vs else 1


def main():
    stamp = os.environ.get("STAMP", "").strip()
    title = os.environ.get("TITLE", "").strip()
    lede = os.environ.get("LEDE", "").strip()
    slug = os.environ.get("SLUG", "").strip() or "log"
    lines = [l.strip() for l in os.environ.get("BODY", "").splitlines() if l.strip()]
    if not STAMP_RE.match(stamp):
        sys.exit("스탬프 형식 오류: %s" % stamp)
    if not SLUG_RE.match(slug):
        sys.exit("파일 이름은 영문 소문자·숫자 24자 이내: %s" % slug)
    if not title or not lines:
        sys.exit("제목과 본문이 필요합니다")

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    posts = json.loads(read(os.path.join(root, "posts.json")))
    if any(p.get("stamp") == stamp for p in posts):
        sys.exit("이미 있는 스탬프: %s" % stamp)
    rel = "p/%s_%s.ko.html" % (stamp.split("_")[0], slug)
    if os.path.exists(os.path.join(root, rel)):
        sys.exit("이미 있는 파일: %s" % rel)

    body = "\n\n".join("    <p>%s</p>" % html.escape(l, quote=False) for l in lines)
    page = PAGE.format(title=html.escape(title), lede=html.escape(lede), css=css_version(root), stamp=stamp, body=body)
    with io.open(os.path.join(root, rel), "w", encoding="utf-8", newline="\n") as f:
        f.write(page)

    posts.insert(0, {"stamp": stamp, "ko": {"title": title, "lede": lede, "file": rel}, "tab": "notice"})
    with io.open(os.path.join(root, "posts.json"), "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(posts, ensure_ascii=False, indent=2) + "\n")
    print("추가 %s" % rel)


if __name__ == "__main__":
    main()
