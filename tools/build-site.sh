#!/usr/bin/env bash
# Assembles the GitHub Pages site: one commit at the root (main), and each
# given pull request's head under pr/<n>/ (see "Previews of pull requests" in
# docs/development.md). Used by .github/workflows/pages.yml and test/site.mjs.
#
# Usage: tools/build-site.sh OUT ROOT_COMMIT [N=COMMIT ...]
#   OUT          the site directory to create (must not exist)
#   ROOT_COMMIT  the commit served at the root (a SHA or a ref)
#   N=COMMIT     pull request N's head, served under pr/N/
#
# Each tree is read from git by its commit (git archive), never checked out
# and never run: only its files are copied. A commit missing locally is
# fetched from origin by its SHA. A pull request that cannot be built is
# skipped with a warning, so that it never stops main's deploy.
set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '6,10p' "$0" >&2
  exit 2
fi
out=$1 root=$2
shift 2
if [ -e "$out" ]; then
  echo "build-site: $out already exists" >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

warn() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::$*"; else echo "build-site: warning: $*" >&2; fi
}

# resolve COMMIT: prints the full SHA, fetching a missing SHA from origin.
resolve() {
  local c=$1
  if ! git cat-file -e "$c^{commit}" 2>/dev/null && [[ $c =~ ^[0-9a-f]{40}$ ]]; then
    git fetch --quiet --no-tags --depth=1 origin "$c" || return 1
  fi
  git rev-parse --verify --quiet "$c^{commit}"
}

# copy SHA DEST [PR]: the site's files of commit SHA into DEST, and its
# version.json. With PR, a preview: no service worker (see sw.js), and a
# listed file that is missing is only a warning. Every step checks its
# status: errexit is off in a function called from an if.
copy() {
  local sha=$1 dest=$2 pr=${3:-} src
  src=$(mktemp -d -p "$tmp") || return 1
  git archive "$sha" | tar -x -C "$src" || return 1
  # A symbolic link could point anywhere on the runner: none is published.
  local link
  while IFS= read -r -d '' link; do
    warn "${pr:+pr $pr: }skipped the symbolic link ${link#"$src"/}"
    rm -f "$link"
  done < <(find "$src" -type l -print0)

  # Only what the page, the manifest and the service worker load: these
  # files, every module at the top level, and the icons.
  # sw.js is one of the modules.
  local files=(index.html lab.html style.css manifest.webmanifest favicon.svg og-image.jpg)
  local f
  for f in "$src"/*.js; do
    [ -f "$f" ] || continue
    f=${f##*/}
    [ -n "$pr" ] && [ "$f" = sw.js ] && continue
    files+=("$f")
  done
  mkdir -p "$dest" || return 1
  for f in "${files[@]}"; do
    if [ -f "$src/$f" ]; then
      cp "$src/$f" "$dest/" || return 1
    elif [ -n "$pr" ]; then
      warn "pr $pr: no $f"
    else
      echo "build-site: $sha has no $f" >&2
      return 1
    fi
  done
  if [ -d "$src/icons" ]; then
    cp -r "$src/icons" "$dest/icons" || return 1
  elif [ -z "$pr" ]; then
    echo "build-site: $sha has no icons/" >&2
    return 1
  fi

  local date
  date=$(git log -1 --format=%cI "$sha") || return 1
  if [ -n "$pr" ]; then
    printf '{"sha":"%s","date":"%s","pr":%s}\n' "$sha" "$date" "$pr" > "$dest/version.json" || return 1
  else
    printf '{"sha":"%s","date":"%s"}\n' "$sha" "$date" > "$dest/version.json" || return 1
  fi
}

mkdir -p "$out"
sha=$(resolve "$root") || { echo "build-site: no commit $root" >&2; exit 1; }
copy "$sha" "$out"
echo "/ $sha"

for arg in "$@"; do
  n=${arg%%=*} c=${arg#*=}
  if ! [[ $n =~ ^[1-9][0-9]*$ ]] || [ "$n" = "$arg" ]; then
    echo "build-site: not N=COMMIT: $arg" >&2
    exit 2
  fi
  if ! sha=$(resolve "$c"); then
    warn "pr $n: could not fetch $c, skipped"
    continue
  fi
  if ! (copy "$sha" "$out/pr/$n" "$n"); then
    warn "pr $n: could not be built, skipped"
    rm -rf "${out:?}/pr/$n"
    continue
  fi
  echo "pr/$n/ $sha"
done
