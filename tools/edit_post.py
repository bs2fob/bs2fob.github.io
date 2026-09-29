# edit_post.py

import html
import io
import json
import os
import re
import sys

FILE_RE = re.compile(r"^p/[A-Za-z0-9_.-]+\.html$")
TOKEN_RE = re.compile(r"<!--.*?-->|<script\b.*?</script>|<style\b.*?</style>|<[^>]*>", re.S | re.I)
TEXT_RE = re.compile(r"[^\t\n\f\r ]")
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)


def read(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


# 태그·주석·스크립트 사이의 글자 조각. 공백뿐인 조각은 빼고 브라우저와 같은 순번을 매긴다
def segments(raw):
    out, last = [], 0
    for m in TOKEN_RE.finditer(raw):
        if TEXT_RE.search(raw[last:m.start()]):
            out.append((last, m.start()))
        last = m.end()
    if TEXT_RE.search(raw[last:]):
        out.append((last, len(raw)))
    return out


def main():
    rel = os.environ.get("FILE", "").strip()
    title = os.environ.get("TITLE", "").strip()
    edits = json.loads(os.environ.get("EDITS", "[]"))
    if not FILE_RE.match(rel):
        sys.exit("파일 경로 오류: %s" % rel)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, rel)
    if not os.path.exists(path):
        sys.exit("없는 파일: %s" % rel)

    raw = read(path)
    segs = segments(raw)
    swaps = []
    for i, old, new in edits:
        if not (0 <= i < len(segs)) or raw[segs[i][0]:segs[i][1]] != old:
            sys.exit("원본이 바뀌어 %d 번 조각이 맞지 않습니다" % i)
        swaps.append((segs[i][0], segs[i][1], new))
    for a, b, new in sorted(swaps, reverse=True):
        raw = raw[:a] + new + raw[b:]

    if title:
        esc = html.escape(title, quote=False)
        raw = TITLE_RE.sub(lambda m: "<title>%s%s</title>" % (esc, " — Bs2FoB" if m.group(1).endswith(" — Bs2FoB") else ""), raw, 1)
        pj = os.path.join(root, "posts.json")
        posts = json.loads(read(pj))
        for p in posts:
            for lang in ("ko", "en"):
                if (p.get(lang) or {}).get("file") == rel:
                    p[lang]["title"] = title
        write(pj, json.dumps(posts, ensure_ascii=False, indent=2) + "\n")

    write(path, raw)
    print("수정 %s  조각 %d 개%s" % (rel, len(swaps), "  제목 변경" if title else ""))


if __name__ == "__main__":
    main()
