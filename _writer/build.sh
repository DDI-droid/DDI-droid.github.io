#!/bin/bash
# Build the site with Jekyll in WSL (as the deploy does) into ~/site-build/out.
#   MSYS_NO_PATHCONV=1 wsl.exe -e bash /mnt/c/Users/AnshulThakur/Documents/anshul-site/_writer/build.sh [production]
# After layout changes, refresh the writer's preview frame:  node _writer/make_shell.cjs
set -eo pipefail
cd /mnt/c/Users/AnshulThakur/Documents/anshul-site
export BUNDLE_APP_CONFIG=$HOME/.anshul-site-bundle
[ "${1:-}" = production ] && export JEKYLL_ENV=production
# Non-interactive WSL shells do not load nvm. Terser needs Node even though
# Jekyll can report success while silently omitting scripts without it.
if ! command -v node >/dev/null 2>&1; then
  for bin in "$HOME/.nvm/current/bin" "$HOME"/.nvm/versions/node/*/bin; do
    if [ -x "$bin/node" ]; then export PATH="$bin:$PATH"; break; fi
  done
fi
if [ "${JEKYLL_ENV:-}" = production ] && ! command -v node >/dev/null 2>&1; then
  echo "Production build needs Node on PATH for jekyll-terser." >&2
  exit 1
fi
rm -rf ~/site-build/out
bundle exec jekyll build --config _config.yml,$HOME/site-build/local.yml -d $HOME/site-build/out 2>&1 | grep -v "AlImgTools: Successfully" | tail -12
if [ ! -s "$HOME/site-build/out/assets/js/lw-footnotes.js" ]; then
  echo "Build failed to emit assets/js/lw-footnotes.js." >&2
  exit 1
fi
