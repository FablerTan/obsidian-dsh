#!/bin/sh
# obsidian-dsh — 安装 git hooks 到 .git/hooks/（幂等；纯 shell 文件操作）
#
# 用法：sh scripts/install-hooks.sh
# 挂载点：package.json 的 postinstall（npm install 自动执行）与 hooks:install（手动）。
# 非 git 仓库、或本目录不是插件根（模板缺失）时静默跳过、exit 0——
# 绝不在无关仓库里写 hooks。

root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
	echo "[hooks] 非 git 仓库，跳过 hooks 安装"
	exit 0
}
template="$root/scripts/githooks/pre-commit"
if [ ! -f "$template" ]; then
	echo "[hooks] 找不到模板（$template），跳过 hooks 安装"
	exit 0
fi

gitdir="$(git rev-parse --git-dir 2>/dev/null)" || gitdir=".git"
case "$gitdir" in
	/*) hooks_dir="$gitdir/hooks" ;;
	*) hooks_dir="$root/$gitdir/hooks" ;;
esac
target="$hooks_dir/pre-commit"

# 幂等：内容一致则跳过
if [ -f "$target" ] && cmp -s "$template" "$target"; then
	echo "[hooks] pre-commit 已是最新（内容一致，跳过）"
	exit 0
fi

cp "$template" "$target" && chmod +x "$target"
echo "[hooks] 已安装 pre-commit → $target"
