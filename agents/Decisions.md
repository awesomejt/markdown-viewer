# Decisions

## Purpose

This file contains a log of important decisions.

## 2026-10-11: Initial Scope And Stack

| # | Decision | Status | Rationale |
| --- | --- | --- | --- |
| D-1 | Deliver as a LAN web app; desktop wrapper deferred | Decided | Must work from an iPad and any LAN device. A browser is the only universal client. |
| D-2 | Files come from the server host and shares mounted on it | Decided (owner) | Simplest, most reliable way to reach network drives. No in-app SMB client or credential storage. |
| D-3 | No authentication (trusted LAN) | Decided (owner) | Home LAN use. Mitigated by read-only access, the root allowlist, and not exposing it to the internet. |
| D-4 | Viewer only, with live reload | Decided (owner) | Keeps the server read-only and simple. Editing may come later. |
| D-5 | Backend in Go | Decided (owner, 2026-10-11) | Native D2 library, single-binary deployment with the UI embedded, cross-compilation to NAS/Pi. Python would need the external `d2` CLI. The backend choice does not affect iPad access. |
| D-6 | React 19 + TypeScript + Vite frontend | Decided (owner preference for React) | Rich Markdown ecosystem. Static build embeds into the server. |
| D-7 | Markdown and Mermaid render client-side; D2 renders server-side | Decided (follows D-5) | Mermaid is browser-only. D2's maintained library is Go, and its WASM build is stale and heavy for an iPad. |
| D-8 | Live reload with fsnotify + polling fallback, delivered over SSE | Proposed | Network mounts often emit no change events. SSE is simple and reconnects in Safari. |
| D-9 | Desktop app: post-MVP. Prefer browser/web-app install, then Wails v3 (once stable), then Electron | Deferred | Wails v3 is still beta (beta.28). Electron is a heavier fallback. |
| D-10 | Voice-over script Markdown extensions considered after MVP, as remark/rehype plugins | Deferred (owner) | Useful for VO scripts (speaker labels, directions, timing, teleprompter). Needs research into existing conventions first. |
| D-11 | Deploy with Docker Compose on a VM server. NAS shares are mounted on the VM and bind-mounted read-only into the container | Decided (owner) | The owner's preferred target. The OS handles SMB/NFS. Network-mounted roots default to polling for live reload, because NAS-side changes emit no inotify events. |
