#!/usr/bin/env bash
# Assembles the static site GitHub Pages serves: the prototype, the simulation modules it loads, and an index page
# that sends visitors to the prototype. The folder layout is kept, so the prototype's ../sim/ paths work unchanged.
#
#   tools/build-site.sh [output directory]      defaults to _site, which must not already hold anything
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-_site}"
page="prototype/shot-model-lab.html"

if [ -e "$out" ] && [ -n "$(ls -A "$out")" ]; then
  echo "$out already has files in it; remove it or pick another directory" >&2
  exit 1
fi
mkdir -p "$out/prototype" "$out/sim"
cp "$root/$page" "$out/$page"

# publish exactly the scripts the page asks for, and fail if one of them is missing
scripts="$(grep -o 'src="\.\./sim/[^"]*"' "$root/$page" | sed 's/^src="\.\.\/sim\///; s/"$//')"
if [ -z "$scripts" ]; then echo "found no ../sim/ scripts in $page" >&2; exit 1; fi
for f in $scripts; do cp "$root/sim/$f" "$out/sim/$f"; done

# Stamp this build on the page and on the game, and have the page ask for its scripts by the stamp. A browser that
# still holds an old copy of a script then fetches the new one, because the address is new; and if a page and a game
# from different builds do meet, the page can tell (see "One version, or none" in the page).
build="$( (cat "$root/$page"; for f in $scripts; do cat "$root/sim/$f"; done) | sha1sum | cut -c1-10)"
grep -q 'const BUILD = "dev";' "$out/$page" || { echo "found no build stamp to fill in, in $page" >&2; exit 1; }
sed -i "s|const BUILD = \"dev\";|const BUILD = \"$build\";|; s|src=\"\.\./sim/\([^\"?]*\)\"|src=\"../sim/\1?v=$build\"|g" "$out/$page"
printf '\nif (typeof window !== "undefined" && window.GameLib) window.GameLib.BUILD = "%s";\n' "$build" >> "$out/sim/game.js"

cat > "$out/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Shot model lab</title>
<meta http-equiv="refresh" content="0; url=prototype/shot-model-lab.html">
<link rel="canonical" href="prototype/shot-model-lab.html">
</head>
<body>
<p><a href="prototype/shot-model-lab.html">Open the shot model lab</a></p>
</body>
</html>
HTML

echo "Built $out, build $build:"
(cd "$out" && find . -type f | sort | sed 's/^\.\//  /')
