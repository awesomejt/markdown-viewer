# Deployment

This guide deploys mdv with Docker Compose on a VM that mounts a NAS. Follow the steps in order. Paths and names (`/mnt/nas/markdown`, `nas.example.lan`) are placeholders.

mdv is for a trusted LAN only. It has no authentication.

## Prerequisites

- A VM with Docker and the Compose plugin, on the same LAN as your devices.
- A NAS share you can mount on the VM.
- A clone of this repository on the VM. The image is built from the checkout; no registry is needed.

## Mount the NAS on the VM

mdv reads the share through the VM, so mount it there first, read-only. Choose the `uid=`/`gid=` of the mount (CIFS) or the file ownership (NFS) to match the `MDV_UID`/`MDV_GID` you will give the container. The defaults are 1000:1000.

CIFS (SMB) in `/etc/fstab`:

```text
//nas.example.lan/markdown  /mnt/nas/markdown  cifs  credentials=/etc/mdv-nas.cred,ro,uid=1000,gid=1000,vers=3.0,actimeo=1,_netdev,nofail  0  0
```

Keep the password out of fstab. Create the credentials file with mode 600:

```text
username=mdv-reader
password=CHANGE_ME
```

```bash
sudo install -m 600 -o root -g root /dev/null /etc/mdv-nas.cred
sudoedit /etc/mdv-nas.cred
```

NFS in `/etc/fstab`:

```text
nas.example.lan:/export/markdown  /mnt/nas/markdown  nfs  ro,vers=4.1,actimeo=1,_netdev,nofail  0  0
```

NFS has no `uid=`/`gid=` mount option. Files appear with the NAS-side owner, so make them readable by `MDV_UID`/`MDV_GID` (or by "other") on the NAS export. To tune only directory caching, use `acdirmin`/`acdirmax` (for example `acdirmax=2`) instead of `actimeo`.

Mount and verify:

```bash
sudo mkdir -p /mnt/nas/markdown
sudo mount /mnt/nas/markdown
ls /mnt/nas/markdown
```

### Attribute caching and live reload

CIFS and NFS clients cache file and directory attributes (modification time, size, directory contents). mdv detects changes by reading those attributes, so a long cache delays live reload by the cache lifetime. The CIFS default for `actimeo` is 1 second, but NFS defaults to up to 60 seconds for `acdirmax`. Use low values (`actimeo=1`, or a small `acdirmax`) so edits show up within about the poll interval. The cost is more metadata traffic to the NAS, which is negligible for a few notes folders.

## Start Docker after the mount

If Docker starts before the NAS is mounted, mdv first opens the empty mount-point directory and switches to the share within about 2 seconds of it appearing (FIX-16). Order the boot anyway, so clients never see the empty folder.

- Use `_netdev` in the fstab options so systemd treats the mount as network-dependent and orders it after the network is up. Add `nofail` so a down NAS does not block boot.
- Avoid `x-systemd.automount` for this mount. An automount makes the path exist before the share is mounted, which is exactly the empty-directory case. If you use it anyway, mdv switches to the share once it is mounted, but its first listings may show the empty directory.
- Make Docker wait for the mounts with a drop-in:

```bash
sudo systemctl edit docker.service
```

```ini
[Unit]
RequiresMountsFor=/mnt/nas/markdown
After=remote-fs.target
```

`RequiresMountsFor=` pulls in and orders after the mount unit for that path. `After=remote-fs.target` waits for all network filesystems. Check the result:

```bash
systemctl show docker.service -p After -p RequiresMountsFor
```

Because of `RequiresMountsFor=`, a failed NAS mount also stops Docker from starting. If you prefer Docker to start regardless, drop `RequiresMountsFor=` and keep `After=remote-fs.target`, and rely on the automatic recovery described under [Startup and recovery](#startup-and-recovery).

## Bind the NAS into the container

In `compose.yaml`, uncomment the NAS bind under `volumes:`:

```yaml
      - type: bind
        source: /mnt/nas
        target: /data/nas
        read_only: true
        bind:
          propagation: rslave
          create_host_path: false
```

Why it looks like this:

- Bind the parent of the mount points (`/mnt/nas`), not `/mnt/nas/markdown`. `rslave` propagates mounts made beneath the source into the container, so a share that is mounted late or remounted appears without recreating the container.
- `read_only: true` makes the container's view read-only even if the NAS mount is not.
- `create_host_path: false` makes Compose fail if `/mnt/nas` is missing, instead of silently creating an empty directory.

With the share at `/mnt/nas/markdown`, its path inside the container is `/data/nas/markdown`.

## Configure

Create a `.env` file next to `compose.yaml`. Compose reads it automatically.

```bash
MDV_ROOTS=markdown=/data/nas/markdown
MDV_UID=1000
MDV_GID=1000
MDV_ALLOWED_HOSTS=nas.example.lan
MDV_PORT=8080
```

- `MDV_ROOTS` uses the container paths. Add more roots with commas, for example `markdown=/data/nas/markdown,notes=/data/nas/notes`. Leave network roots on the default `poll` mode.
- `MDV_UID`/`MDV_GID` must match the mount (see above).
- `MDV_ALLOWED_HOSTS` is needed if you will open mdv by name. See [Opening by hostname](#opening-by-hostname).
- A root path must be a real directory (or a mount point), not a symlink; symlinks in its parent folders are fine. A root may be a subfolder of a share (`notes=/data/nas/markdown/notes`), but then everyone who can write to its parent folders can rename or replace it. mdv refuses a root that is a symlink (also after a restart), resolves symlinks in the parent folders once, and on every open checks the whole path without following symlinks, so a root or parent folder replaced by a symlink while mdv runs goes unavailable instead of exposing other files (FIX-21). A parent folder replaced by a symlink before mdv starts is still followed, so keep the parent folders, up to the mount point, writable only by trusted users. The root then shows as unavailable until the directory is put back. To point a root elsewhere, edit `MDV_ROOTS` and restart.

- Global preferences (optional): copy `config/preferences.example.yaml` to `config/preferences.yaml` in the stack folder. The file is untracked, so re-archiving the stack does not overwrite it, and mdv re-reads it on every request. Keep it out of the served roots.

The `.env` file holds no secrets, but keep it out of Git if it names private paths.

## Start and check

```bash
docker compose up -d --build
docker compose ps
docker compose logs mdv
```

`docker compose ps` should show the service as healthy within about 30 seconds. The logs list each root and warn about any that are unavailable. Then open `http://<vm-ip>:8080` (or `http://nas.example.lan:8080` if listed in `MDV_ALLOWED_HOSTS`) on the iPad. In Safari, Share, then Add to Home Screen, adds mdv with its own icon; it opens full screen without the Safari toolbar (use the breadcrumbs or the edge-swipe gesture to go back). Add it from the address you will keep using: the home-screen app is tied to that origin, and its storage (theme, recent items) is separate from Safari's.

## Run under systemd (shared Docker host)

On a VM that runs several Compose apps, manage each stack with the generic template unit in `deploy/systemd/` instead of making `docker.service` wait for the NAS. Each stack lives in `/opt/stacks/<name>/` and runs as `docker-compose@<name>.service`:

- `start` runs `docker compose up -d --wait` (waits for the healthcheck).
- `stop` runs `docker compose down`, so no container is left for Docker to auto-start at the next boot before the NAS is mounted.
- `reload` runs `docker compose up -d --build --wait`, which rebuilds the image and recreates the container if anything changed.

The mdv drop-in (`deploy/systemd/docker-compose@mdv.service.d/nas.conf`) orders the stack after `mnt-content.mount`. It uses `Wants=`, not `RequiresMountsFor=`, so a NAS outage or an automount idle unmount never stops the stack (mdv reopens the root itself). Change the unit name if your mount point is not `/mnt/content` (`systemd-escape -p --suffix=mount /mnt/nas`).

Install on the VM (the `deploy/` paths are from this checkout):

```bash
sudo install -d -o "$USER" -g "$USER" /opt/stacks/mdv
git archive HEAD | tar -x -C /opt/stacks/mdv          # or git clone into it
cp deploy/compose.override.example.yaml /opt/stacks/mdv/compose.override.yaml
install -m 600 /dev/null /opt/stacks/mdv/.env && "$EDITOR" /opt/stacks/mdv/.env   # see Configure
sudo install -m 644 deploy/systemd/docker-compose@.service /etc/systemd/system/
sudo install -D -m 644 deploy/systemd/docker-compose@mdv.service.d/nas.conf \
  /etc/systemd/system/docker-compose@mdv.service.d/nas.conf
sudo systemctl daemon-reload
sudo systemctl enable --now docker-compose@mdv
```

Then `systemctl status|stop|start|restart|reload docker-compose@mdv`. Compose merges `compose.override.yaml` automatically, so the NAS bind stays out of the tracked `compose.yaml`. To upgrade, refresh the files in `/opt/stacks/mdv` (keep `.env` and `compose.override.yaml`), set `MDV_VERSION` to the new tag or commit, and run `sudo systemctl reload docker-compose@mdv`.

An `x-systemd.automount` mount also works with this setup (tested on the VM): the drop-in triggers the real mount before Compose starts, and mdv keeps the root open, so the idle timeout does not unmount it.

## Opening by hostname

Every route checks the `Host` header (DNS rebinding guard). IP literals and `localhost` always pass and the port is ignored. Any other name must be listed in `MDV_ALLOWED_HOSTS` (comma-separated, case-insensitive, no scheme, no port); otherwise mdv answers `421 host_not_allowed`. `MDV_ALLOWED_HOSTS=*` disables the check and logs a warning; use it only behind a proxy you control.

If you put a reverse proxy in front of mdv:

- Preserve the client's `Host` header, or terminate TLS at the proxy. Otherwise D2 renders get 403, because the cross-origin check compares `Origin` with `Host` over plain HTTP.
- If the proxy forwards a different `Host`, list that name or use `*`.
- All clients appear to come from the proxy's IP, so they share the cap of 16 live-reload streams. `X-Forwarded-For` is ignored on purpose.

## Startup and recovery

- A root that is missing, erroring, or hung at boot (for example a NAS that is still starting) does not stop mdv. The root starts unavailable, a warning is logged, and a background probe opens it once it answers, with no restart.
- A root path that exists but is not a directory fails startup, as do syntax errors in `MDV_ROOTS`.
- If the mount-point directory exists but the share is not mounted yet, mdv opens the empty directory. While the root is in use, mdv compares the device and inode of the root path with the open directory at most every 2 seconds and reopens the root when they differ, so a share that mounts (or unmounts) later is picked up without a restart (FIX-16). A root path (or a parent folder) replaced by a symlink is not followed: the root goes unavailable until the directory is back (FIX-21). Roots in `:fsnotify` mode may still miss change events until restart, so use polling for NAS roots.

## Upgrade

```bash
cd /path/to/markdown
git pull
docker compose up -d --build
```

Compose rebuilds the image and recreates the container. To pin a version tag, set `MDV_VERSION` in `.env`.

## Troubleshooting

- `421 host_not_allowed`: add the hostname to `MDV_ALLOWED_HOSTS`, then `docker compose up -d`.
- `403` or "permission denied" on files: the container user cannot read the share. Align `MDV_UID`/`MDV_GID` with the CIFS `uid=`/`gid=` or the NFS file ownership. The image has no shell, so test on the VM instead: `sudo -u '#1000' ls /mnt/nas/markdown`.
- Stale content or slow live reload: lower `actimeo`/`acdirmax`, shorten `MDV_POLL_INTERVAL`, and make sure network roots are not set to `fsnotify`.
- `503 busy`: either more than 16 live-reload streams from one client IP (close tabs) or no D2 render slot free (retry).
- Root unavailable or empty after reboot: see [Startup and recovery](#startup-and-recovery).
- Unhealthy container: `docker compose logs mdv`. The healthcheck runs `mdv healthcheck`, which requests `/healthz` on loopback.
