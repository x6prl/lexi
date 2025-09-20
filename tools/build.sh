#!/usr/bin/env bash
set -euo pipefail

# =========================================
#   lexi — офлайн single-file сборка
#   Правильный порядок JS + потоковая подстановка в шаблон
#   Без sed -i "s/@@...@@" → нет "Argument list too long"
# =========================================

# ---- пути ----
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/src"
JS_DIR="$SRC_DIR/js"
CSS_DIR="$SRC_DIR/css"
DIST_DIR="$ROOT_DIR"

TEMPLATE="$SRC_DIR/index.html.template"
OUT_HTML="$DIST_DIR/index.html"

TMP_DIR="${TMPDIR:-/tmp}/lexi_build.$$"
mkdir -p "$TMP_DIR" "$DIST_DIR"

# ---- утилиты ----
join_js() {
  local out="$1"; shift
  : > "$out"
  for f in "$@"; do
    if [[ ! -f "$f" ]]; then
      echo "Missing JS file: $f" >&2
      exit 1
    fi
    echo -e "\n/* ===== BEGIN JS: ${f#"$ROOT_DIR/"} ===== */" >> "$out"
    cat "$f" >> "$out"
    echo -e "\n/* ===== END JS ===== */" >> "$out"
  done
}

minify_css() {
  # Лёгкая минификация без внешних тулов (безопасно для inline)
  sed -E '
    s:/\*[^*]*\*+([^/*][^*]*\*+)*/::g;   # комментарии
    s:[[:space:]]+$::g;                   # хвостовые пробелы
    s:[[:space:]]+: :g;                   # схлопываем множественные пробелы
  ' | tr -d '\n'
}

# ---- 1) CSS ----
CSS_SRC="$CSS_DIR/app.inline.css"
[[ -f "$CSS_SRC" ]] || { echo "Missing CSS: $CSS_SRC" >&2; exit 1; }

CSS_BUNDLE_RAW="$TMP_DIR/bundle.css"
cat "$CSS_SRC" | minify_css > "$CSS_BUNDLE_RAW"

# ---- 2) JS (порядок критичен) ----
JS_BUNDLE="$TMP_DIR/bundle.js"
join_js "$JS_BUNDLE" \
  "$JS_DIR/core/utils.inline.js" \
  "$JS_DIR/core/lexidb.inline.js" \
  "$JS_DIR/core/rng.inline.js" \
  "$JS_DIR/core/verbdb.inline.js" \
  "$JS_DIR/core/verbtrainer.inline.js" \
  "$JS_DIR/core/lexiparts.inline.js" \
  "$JS_DIR/core/cardengine.inline.js" \
  "$JS_DIR/widgets/dbStatistics.inline.js" \
  "$JS_DIR/widgets/keypad.inline.js" \
  "$JS_DIR/widgets/wordchoice.inline.js" \
  "$JS_DIR/widgets/exercise_ui.inline.js" \
  "$JS_DIR/widgets/exercise_layout.inline.js" \
  "$JS_DIR/widgets/dbItemStatistics.inline.js" \
  "$JS_DIR/screens/home.inline.js" \
  "$JS_DIR/screens/excercise.inline.js" \
  "$JS_DIR/screens/roundResult.inline.js" \
  "$JS_DIR/screens/excerciseResult.inline.js" \
  "$JS_DIR/screens/dbList.inline.js" \
  "$JS_DIR/screens/dbItemEdit.inline.js" \
  "$JS_DIR/screens/dbItemAdd.inline.js" \
  "$JS_DIR/screens/verbs.inline.js" \
  "$JS_DIR/app.js"

# ---- 3) Стриминговая подстановка плейсхолдеров (без sed -e "s/.../огромный текст/") ----
[[ -f "$TEMPLATE" ]] || { echo "Missing template: $TEMPLATE" >&2; exit 1; }

awk -v CSS_FILE="$CSS_BUNDLE_RAW" -v JS_FILE="$JS_BUNDLE" '
  {
    if (index($0, "@@INLINE_CSS@@")) {
      # Вставляем CSS как есть
      while ((getline line < CSS_FILE) > 0) print line
      close(CSS_FILE)
      next
    }
    if (index($0, "@@INLINE_JS@@")) {
      # Вставляем JS как есть
      while ((getline line < JS_FILE) > 0) print line
      close(JS_FILE)
      next
    }
    print
  }
' "$TEMPLATE" > "$OUT_HTML"

echo "✅ Built: $OUT_HTML"
