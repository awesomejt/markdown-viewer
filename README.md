# mdv: LAN Markdown Viewer

mdv is a self-hosted, read-only Markdown viewer for a home network. One server on a host machine lets any LAN device (iPad, phone, desktop) browse that host's folders and mounted network shares, open folders as workspaces, and read Markdown with Mermaid and D2 diagrams. Pages reload live when files change. It is a Go server with an embedded React single-page app, shipped as one static binary or a Docker image.

> **LAN only.** mdv has no authentication. It never writes to your files, but anyone who can reach the port can read everything under the configured roots. Run it on a trusted home network and never expose it to the internet.

Features:

- Browse named roots (local folders or mounted NAS shares) and open any folder as a workspace.
- GitHub-flavored Markdown with syntax-highlighted code, KaTeX math (`$...$`, `$$...$$`, ```` ```math ````), GitHub alerts (`> [!NOTE]`), front matter, relative links, anchors, and a table of contents.
- Syntax-highlighted code and config files (Go, Python, TypeScript, YAML, and more).
- Mermaid diagrams render in the browser. D2 diagrams render on the server. Each diagram can show its source or open full screen with pan and zoom (drag, wheel, pinch on iPad, `+`/`-`/`0`). D2 supports the dagre (default) and ELK layouts: pick one from a diagram's Layout menu, or set `vars: {d2-config: {layout-engine: elk}}` in the source.
- Live reload when a file changes (mtime polling, or inotify for local disks).
- Light and dark themes, usable on an iPad.
- Works offline: all assets and fonts are embedded, and nothing is fetched from the internet at runtime.
- Hardened container: read-only filesystem, all capabilities dropped, non-root user, read-only bind mounts.

## Quick start (local)

Prerequisites: Go 1.27 or newer, Node 24 (matches the Dockerfile), and `make`.

```bash
make deps   # first time only: installs npm dependencies
make run    # builds the web app and the binary, then serves ./examples
```

Open <http://localhost:8080>. The `examples/` folder is the default root and has a tour of the supported Markdown, Mermaid, and D2 features. To serve your own folders, set `MDV_ROOTS`:

```bash
MDV_ROOTS=notes=$HOME/notes make run
```

Other useful targets (run `make help` for the full list): `make build` (binary at `build/mdv`), `make check` (lint, tests, coverage), `make e2e` (Playwright, needs Docker), `make docker` (build the image).

## Quick start (Docker Compose)

```bash
docker compose up -d --build
```

This serves the bundled `examples/` on port 8080. Check it with `docker compose ps` (the service should become healthy) and open `http://<host-ip>:8080`. To serve your own files, see [Deploying on a VM](#deploying-on-a-vm).

## Configuration

mdv is configured with environment variables only. Empty values count as unset, and startup fails with all validation errors listed if a value is invalid.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MDV_ROOTS` | _(required)_ | Comma-separated `name=/abs/path[:watch]` entries. `watch` is `poll` (default) or `fsnotify`. Names match `^[a-z0-9][a-z0-9_-]{0,31}$`. Example: `markdown=/data/nas/markdown,notes=/data/notes:fsnotify`. |
| `MDV_LISTEN` | `:8080` | Listen address. |
| `MDV_POLL_INTERVAL` | `2s` | How often `poll` roots are checked for changes. |
| `MDV_ALLOWED_HOSTS` | _(none)_ | Extra hostnames accepted in the `Host` header. IP literals and `localhost` always work. `*` alone disables the check. See [Opening by hostname](#opening-by-hostname). |
| `MDV_FS_TIMEOUT` | `5s` | Timeout for a single filesystem operation (guards against dead mounts). |
| `MDV_FS_MAX_INFLIGHT` | `4` | Per-root cap on concurrent filesystem operations. |
| `MDV_MAX_LIST_ENTRIES` | `20000` | Maximum entries in one folder listing; the response is marked truncated beyond it. |
| `MDV_MAX_FILE_BYTES` | `5242880` | Largest text file served without an explicit force (5 MiB). |
| `MDV_D2_TIMEOUT` | `10s` | Per-diagram D2 render timeout. |
| `MDV_D2_CONCURRENCY` | `2` | Concurrent D2 renders. |
| `MDV_D2_CACHE_ENTRIES` | `256` | Size of the rendered-SVG cache. |
| `MDV_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |

Durations use Go syntax (`500ms`, `2s`, `1m`). The binary also has `mdv version` and `mdv healthcheck` subcommands; `mdv` alone is the same as `mdv serve`.

`compose.yaml` forwards only `MDV_ROOTS`, `MDV_POLL_INTERVAL`, and `MDV_ALLOWED_HOSTS` from your environment or `.env` file. It fixes `MDV_LISTEN` and `MDV_LOG_LEVEL`. To change any other variable, add it under `environment:` in `compose.yaml`.

Compose-only variables (read by Compose, not by mdv):

| Variable | Default | Meaning |
| --- | --- | --- |
| `MDV_PORT` | `8080` | Host port published for the container. |
| `MDV_UID` | `1000` | User ID the container runs as. Must be able to read the NAS mount. |
| `MDV_GID` | `1000` | Group ID the container runs as. |
| `MDV_VERSION` | `dev` | Image tag and version string baked into the binary. |

## Deploying on a VM

The full walk-through is in [docs/Deployment.md](docs/Deployment.md). In short, in this order:

1. Mount the NAS share on the VM, read-only, with `uid=`/`gid=` matching `MDV_UID`/`MDV_GID` and low attribute caching (CIFS `actimeo=1`).
2. Make Docker start only after the mount is up (`_netdev`, `RequiresMountsFor=`).
3. Uncomment the NAS bind in `compose.yaml`. Bind the parent of the mount points with `propagation: rslave`.
4. Put `MDV_ROOTS`, `MDV_UID`, `MDV_GID`, and `MDV_ALLOWED_HOSTS` in a `.env` file next to `compose.yaml`.
5. Run `docker compose up -d --build`, check health, and open it from the iPad.

### Opening by hostname

Every route checks the `Host` header to block DNS rebinding. Opening `http://192.168.1.20:8080` or `http://localhost:8080` always works. Opening `http://nas.local:8080` returns `421 host_not_allowed` unless the name is listed:

```bash
MDV_ALLOWED_HOSTS=nas.local,nas.example.lan
```

The port is ignored and names are case-insensitive. Set `MDV_ALLOWED_HOSTS=*` to disable the check only if you must; mdv logs a warning. A reverse proxy in front of mdv must preserve the original `Host` header (or terminate TLS), otherwise D2 renders fail with 403. If the proxy rewrites `Host`, list the rewritten name or use `*`.

## Live reload

- `poll` (default): mdv checks modification times every `MDV_POLL_INTERVAL`. Works on any filesystem, including SMB and NFS.
- `fsnotify`: uses inotify and reacts immediately, but only on local disks. SMB and NFS shares usually produce no events, so keep network roots on `poll`. Opt in per root: `notes=/data/notes:fsnotify`.
- NAS attribute caching can delay changes by seconds to minutes regardless of mode. See [docs/Deployment.md](docs/Deployment.md#mount-the-nas-on-the-vm).
- The open file, the browsed folder and the folders shown in the workspace sidebar update live: new, deleted and renamed files appear or disappear without a reload.
- Each browser tab holds one event stream. The server allows 16 streams per client IP (and 64 in total); extra tabs get `503 busy`. Behind a reverse proxy, all tabs share the proxy's IP and therefore one cap of 16.

## Startup and availability

- A root that is missing, erroring, or too slow to answer at boot does not stop mdv. It starts as unavailable, logs a warning, and recovers by itself once the path answers.
- A root path that exists but is a file fails startup. A bad name, a duplicate name, or a relative path also fails startup.
- If the mount-point directory exists but the NAS is not mounted yet, mdv opens the empty directory and switches to the share within about 2 seconds of it being mounted. No restart is needed. The boot ordering in [docs/Deployment.md](docs/Deployment.md#start-docker-after-the-mount) avoids the empty folder altogether.

## Network use

No internet is needed at runtime. The UI, fonts, and Mermaid are bundled, and D2 is rendered by the server. One exception: remote `http(s)` images referenced inside a Markdown file are loaded by the browser from the network, so those third parties can see the client's IP address and open time. This is an accepted risk for a LAN tool.

## Upgrading

```bash
git pull
docker compose up -d --build
```

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `421 host_not_allowed` | You opened mdv by a hostname that is not listed. Add it to `MDV_ALLOWED_HOSTS`. |
| `403` or "permission denied" on NAS files | The container user cannot read the mount. Make `MDV_UID`/`MDV_GID` match the mount's `uid=`/`gid=` options. |
| D2 diagrams fail with 403 behind a proxy | The proxy changed or dropped `Host`. Preserve it or terminate TLS. |
| Edits on the NAS appear late or not at all | NAS attribute caching (lower `actimeo`/`acdirmax`), a long `MDV_POLL_INTERVAL`, or a network root set to `fsnotify`. |
| `503 busy` on live reload or D2 | Too many event streams for one client IP (16 cap), or no D2 render slot free. Close tabs or retry. |
| Root shows as unavailable or empty after a reboot | The NAS was not mounted when mdv started. Restart the service and fix the boot ordering. |
| Container is unhealthy | Run `docker compose logs mdv`. The check calls `mdv healthcheck`, which needs the server listening on `MDV_LISTEN`. |

## Documentation

- [docs/Requirements.md](docs/Requirements.md): what mdv must do.
- [docs/Architecture.md](docs/Architecture.md): design, API, security model.
- [docs/Tech-Stack.md](docs/Tech-Stack.md): stack choices and deployment.
- [docs/Implementation.md](docs/Implementation.md): task plan and workflow.
- [docs/Deployment.md](docs/Deployment.md): VM and NAS deployment guide.
- [agents/Decisions.md](agents/Decisions.md): decision log.

## Project files and AI workflow

AI assistants and humans start with the root files:

- `AGENTS.md`: operating instructions for AI assistants.
- `TODO.md`: prioritized task list and blockers.
- `MEMORY.md`: persistent decisions, milestones, and run notes.
- `status.yaml`: current project state for humans and automation.

Supporting folders: `docs/` (design docs), `agents/` (decision log, research), `.agents/chats/` (local transcripts, ignored by Git), `working/` (scratch, ignored), `build/` (artifacts, ignored).

Use Conventional Commits. Enable the commit template once per clone:

```bash
git config commit.template .gitmessage
```
