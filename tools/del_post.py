# del_post.py

import io
import json
import os
import re
import sys

STAMP_RE = re.compile(r"^\d{2}w\d{3}v\d{3}_\d{4}$")
SRC_RE = re.compile(r'src="([^"#?:]+)[^"]*"')


def read(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return f.read()


def post_files(post):
    return sorted({post[l]["file"] for l in ("ko", "en") if post.get(l) and post[l].get("file")})


# 지울 글만 참조하는 이미지를 고른다. 남는 글이 같은 파일을 쓰면 남긴다
def orphan_assets(root, gone, keep):
    refs = set()
    for rel in gone:
        path = os.path.join(root, rel)
        if not os.path.exists(path):
            continue
        base = os.path.dirname(rel)
        for src in SRC_RE.findall(read(path)):
            target = os.path.normpath(os.path.join(base, src)).replace("\\", "/")
            if target.startswith("p/img/") and os.path.exists(os.path.join(root, target)):
                refs.add(target)
    used = set()
    for rel in keep:
        path = os.path.join(root, rel)
        if os.path.exists(path):
            text = read(path)
            used.update(r for r in refs if os.path.basename(r) in text)
    return sorted(refs - used)


def main():
    if len(sys.argv) != 2 or not STAMP_RE.match(sys.argv[1]):
        sys.exit("사용법: del_post.py <스탬프>  예) 26w395v190_0925")
    stamp = sys.argv[1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    posts = json.loads(read(os.path.join(root, "posts.json")))

    hit = [p for p in posts if p.get("stamp") == stamp]
    if not hit:
        sys.exit("posts.json 에 없는 스탬프: %s" % stamp)
    rest = [p for p in posts if p.get("stamp") != stamp]

    gone = post_files(hit[0])
    keep = {f for p in rest for f in post_files(p)}
    gone = [f for f in gone if f not in keep]
    assets = orphan_assets(root, gone, keep)

    for rel in gone + assets:
        path = os.path.join(root, rel)
        if os.path.exists(path):
            os.remove(path)
            print("삭제 %s" % rel)

    with io.open(os.path.join(root, "posts.json"), "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(rest, ensure_ascii=False, indent=2) + "\n")
    print("posts.json  %d → %d 편" % (len(posts), len(rest)))


if __name__ == "__main__":
    main()
