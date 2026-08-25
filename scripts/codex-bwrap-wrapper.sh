#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDCLI_WORKSPACE_ROOT:?Strict isolation requires CLOUDCLI_WORKSPACE_ROOT}"
: "${CLOUDCLI_CODEX_BINARY:?Strict isolation requires CLOUDCLI_CODEX_BINARY}"

if ! command -v bwrap >/dev/null 2>&1; then
  echo "Strict workspace isolation is enabled, but bubblewrap is unavailable." >&2
  exit 78
fi
if [[ ! -d "$CLOUDCLI_WORKSPACE_ROOT" ]]; then
  echo "Configured workspace root is not an existing directory." >&2
  exit 78
fi
resolved_workspace_root="$(realpath -e -- "$CLOUDCLI_WORKSPACE_ROOT")"
if [[ "$resolved_workspace_root" != "$CLOUDCLI_WORKSPACE_ROOT" ]]; then
  echo "Configured workspace root changed or resolves through a symlink." >&2
  exit 78
fi
if [[ ! -x "$CLOUDCLI_CODEX_BINARY" ]]; then
  echo "The isolated Codex executable is unavailable." >&2
  exit 78
fi

CODEX_HOME="${HOME:-/root}/.codex"
if [[ -L "$CODEX_HOME" ]]; then
  echo "Strict Codex state directory must not be a symlink." >&2
  exit 78
fi
mkdir -p "$CODEX_HOME"
resolved_codex_home="$(realpath -e -- "$CODEX_HOME")"
if [[ "$resolved_codex_home" != "$CODEX_HOME" ]]; then
  echo "Strict Codex state directory resolves outside its fixed location." >&2
  exit 78
fi

bwrap_args=(
  --unshare-user
  --unshare-pid
  --unshare-ipc
  --unshare-uts
  --unshare-cgroup
  --die-with-parent
  --new-session
  --cap-drop ALL
  --ro-bind /usr /usr
  --ro-bind /proc /proc
  --dev /dev
  --tmpfs /tmp
  --dir /etc
  --dir /root
)

workspace_parent="/"
IFS='/' read -ra workspace_segments <<< "${CLOUDCLI_WORKSPACE_ROOT#/}"
for segment in "${workspace_segments[@]}"; do
  [[ -z "$segment" ]] && continue
  workspace_parent="${workspace_parent%/}/$segment"
  bwrap_args+=(--dir "$workspace_parent")
done
bwrap_args+=(--bind "$CLOUDCLI_WORKSPACE_ROOT" "$CLOUDCLI_WORKSPACE_ROOT")

codex_parent="$(dirname "$CODEX_HOME")"
bwrap_args+=(--dir "$codex_parent" --dir "$CODEX_HOME")
bwrap_args+=(--bind "$CODEX_HOME" "$CODEX_HOME")

for system_path in /bin /lib /lib64 /usr/local; do
  if [[ -e "$system_path" ]]; then
    bwrap_args+=(--ro-bind "$system_path" "$system_path")
  fi
done

for system_file in \
  /etc/ca-certificates \
  /etc/ssl \
  /etc/resolv.conf \
  /etc/hosts \
  /etc/nsswitch.conf \
  /etc/passwd \
  /etc/group \
  /etc/gitconfig; do
  if [[ -e "$system_file" ]]; then
    bwrap_args+=(--ro-bind "$system_file" "$system_file")
  fi
done


exec bwrap "${bwrap_args[@]}" "$CLOUDCLI_CODEX_BINARY" "$@"
