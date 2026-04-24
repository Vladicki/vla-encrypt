# vla-encrypt

Simple Wails desktop app with Go backend and React frontend.

## What you need

### All platforms
- Go
- Node.js + npm
- Wails CLI

Install Wails CLI:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
wails doctor
```

## Platform requirements

### Linux
Required system packages:
- gcc build tools
- GTK3 dev package
- WebKitGTK dev package

If your distro uses WebKit 4.1 instead of 4.0, build with the `webkit2_41` tag.

### macOS
Install Xcode Command Line Tools:

```bash
xcode-select --install
```

### Windows
Required:
- WebView2 Runtime
- C/C++ build tools

Run `wails doctor` to confirm setup.

## Install project dependencies

From project root:

```bash
cd frontend
npm install
cd ..
```

## Run app in development

```bash
wails dev
```

## Build app

### Default build

```bash
wails build
```

### Linux with WebKit 4.1

```bash
wails build -tags webkit2_41
```

## Output

Built app uses the name:

```text
vla-encrypt
```

## Included helper scripts

Optional scripts in `scripts/`:
- `install-wails-cli.sh`
- `build.sh`
- `build-windows.sh`
- `build-macos.sh`
- `build-macos-arm.sh`
- `build-macos-intel.sh`
